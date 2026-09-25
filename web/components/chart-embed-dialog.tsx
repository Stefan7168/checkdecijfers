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

// Row 2 (session 110 UX audit pass 2): the generated snippet used to hardcode
// height="440" while a DEFAULT embedded chart (single series, no markers, no
// definitionLine, the standard attribution + "Frozen on …" footer) renders
// noticeably taller — measured by that audit's hermetic-harness pass (real
// Playwright layout, zero LLM spend; docs/session-briefs/
// 2026-09-17-session-110-ux-audit-pass2.md, row 2) at a last-element bottom
// of 604.5px inside a 600px-wide iframe. At 440 the CBS source line, the
// "Frozen on …" date and the checkdecijfers.nl attribution — the exact things
// the product's public claim promises are shown — sat below an inner
// scroller's fold. Derivation: 604.5px measured content, rounded up to 680px
// to leave ~75px of margin for the attribution/footer line wrapping to two
// lines on a host page narrower than 600px (a journalist's sidebar column is
// the common case this margin is for). Not a substitute for the page itself
// growing with its content (a taller FIXED number still clips an unusually
// tall chart — e.g. one with markers or a long definitionLine) — see the
// embed page's own layout comment for that residual.
export const EMBED_DEFAULT_HEIGHT_PX = 680;

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

// Session 110 (embed auto-resize, ADR 041 addendum): the inline listener
// appended after the <iframe> by buildEmbedCode. Plain ES5 — no arrow
// functions, no let/const, no dependencies — since it runs verbatim on
// whatever third-party host page the reader pastes it into, with no build
// step of its own. One-way and minimal by design (HARD LIMIT): it only ever
// reads `event.data`/`event.source`, it never sends anything back, and the
// only field it acts on is a plain pixel height — matching EmbedResize's own
// (web/app/embed/[token]/embed-resize.tsx) one-way, no-token payload.
// `event.source === iframe.contentWindow` is what lets several embeds on the
// same host page each resize only THEIR OWN iframe — `data-checkdecijfers-
// embed` (set to this embed's own token, already unique per embed) is the
// selector that finds the right one, mirroring EmbedResize's message
// `type` string exactly (`checkdecijfers:embed-height`) so the two halves of
// this mechanism can never silently drift apart.
// Exported (Task 6, own-data publish, ADR 057): own-chart-publish-dialog.tsx
// reuses this SAME script verbatim for the own-data embed snippet — the two
// halves of the resize mechanism (this script + EmbedResize) must never
// exist as two near-identical copies that could silently drift apart.
export function buildEmbedResizeScript(token: string): string {
  return [
    '<script>',
    '(function () {',
    `  var f = document.querySelector('iframe[data-checkdecijfers-embed="${token}"]');`,
    "  window.addEventListener('message', function (e) {",
    '    var d = e.data;',
    "    if (!d || d.type !== 'checkdecijfers:embed-height' || !f) return;",
    '    if (e.source !== f.contentWindow) return;',
    "    f.style.height = d.height + 'px';",
    '  });',
    '})();',
    '</script>',
  ].join('\n');
}

function buildEmbedCode(
  token: string,
  opts: {
    lang: Lang;
    colour: ColourOption;
    chartType: ChartTypeOption;
    currentForm: string | null;
    live: boolean;
    /** #229 (ADR 041 addendum, session 110): true when the spec's OWN
     * default form (chart-view-state.ts's `defaultFormIsTable`, the exact
     * predicate chart.tsx's own `initialForm` calc uses) is Tabel. "Default"
     * can never mean "omit `form`, let the spec decide" here — the embed
     * page structurally refuses `?form=table` and always falls back to the
     * spec's own default when `form` is absent, which in this case IS
     * table (open-questions #229's original finding: a >15-series chart the
     * publisher switched to Lijn/Staaf still embeds as a Tabel with
     * chart-type "Default"). A belt-and-suspenders check: the caller
     * (ChartEmbedDialog) already hides the "Default" radio in this case, so
     * `chartType` should never actually arrive here as `'default'` — this
     * is the second, independent check the rest of this codebase's
     * defensive style favours (never trust a UI-only guard for a
     * correctness fix). */
    defaultIsTable: boolean;
  },
  title: string,
): string {
  const params = new URLSearchParams({ lang: opts.lang, theme: opts.colour });
  const effectiveChartType: ChartTypeOption = opts.chartType === 'default' && opts.defaultIsTable ? 'as-shown' : opts.chartType;
  if (effectiveChartType === 'as-shown' && opts.currentForm) params.set('form', opts.currentForm);
  if (opts.live) params.set('live', '1');
  // `data-checkdecijfers-embed="${token}"` (session 110): the token is
  // already unique per embed, so it doubles as the selector the appended
  // script uses to find THIS iframe among possibly several on the same host
  // page — no separate id generator needed (cheapest-mechanism-first).
  const iframe = `<iframe src="${APP_URL}/embed/${token}?${params.toString()}" width="100%" height="${EMBED_DEFAULT_HEIGHT_PX}" title="${title}" loading="lazy" style="border:0" data-checkdecijfers-embed="${token}"></iframe>`;
  return `${iframe}\n${buildEmbedResizeScript(token)}`;
}

export function ChartEmbedButton({
  auditId,
  tableId,
  lang,
  currentForm = null,
  defaultIsTable = false,
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
  /** #229 (ADR 041 addendum, session 110): true when the PRIMARY spec's own
   * default form is Tabel (`defaultFormIsTable`, chart-view-state.ts —
   * chart.tsx passes the exact same predicate its own `initialForm` calc
   * uses). Table form has never been embeddable — the embed page refuses a
   * hand-crafted `?form=table` outright — so offering "Default" here would
   * silently mean "omit `form`, land on the un-embeddable Tabel view
   * anyway" for exactly the charts this concerns (open-questions #229). The
   * dialog hides that option in this case instead of offering a choice that
   * either does nothing useful or would need its own refusal path. Defaults
   * to `false` for every call site that doesn't pass it (none should be
   * newly broken; the two real call sites in chart.tsx always pass it). */
  defaultIsTable?: boolean;
  // Task 3 (chart-visual-embed-pass): controlled, mirroring
  // ChartConfigPanel's own open/onOpenChange contract — chart.tsx lifts this
  // into its shared `openPanel` state so Style/Story/Embed share one slot.
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The live chart canvas + legend, lifted from chart.tsx — rendered inside
   * the embed modal's left pane, mirroring the Style editor's chartSlot. */
  chartSlot: ReactNode;
  /** #254 Task 6 addendum: true while a non-primary reading is selected. An
   * embed URL always MINTS on the PRIMARY reading — the stored audit row
   * carries no reading selection, so `?reading=` is never emitted at
   * generation time — but the dialog's live preview shows whatever is
   * currently on screen — which, once a reader can switch readings, could
   * be an alternate. Without this, a reader could switch to an alternate,
   * click Embed, see the alternate's own data in the preview, and copy code
   * believing it publishes THAT — when the freshly-minted URL always opens
   * on the primary instead. Same disabled-with-a- reason convention as
   * chart.tsx's own Lijn/Vlak/Liggend tabs and story lock: `disabled` +
   * `title` (pointer) + `aria-describedby` (screen reader/keyboard) pointing
   * at a co-located `sr-only` reason span, both owned entirely by this
   * component so the caller only ever passes the one boolean.
   *
   * Superseded in part, session 110 (#262(c), ADR 041 addendum): once the
   * embed page actually loads, `/embed/[token]` NOW does carry a
   * `chartAlternates` concept — it renders the same reading dropdown chat/
   * dock do, sourced from the audit row's own stored `chartAlternates`, so a
   * VIEWER of the published embed can switch reading client-side after the
   * page loads. That does not change this prop's own reasoning above: the
   * dialog still disables Embed while previewing a non-primary reading,
   * because the generated URL/code always starts on the primary regardless
   * of what the publisher was looking at when they clicked Embed. */
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
          defaultIsTable={defaultIsTable}
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
  defaultIsTable,
  chartSlot,
  onClose,
}: {
  auditId: number;
  tableId: string;
  lang: Lang;
  currentForm: string | null;
  defaultIsTable: boolean;
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
          { lang: embedLang, colour, chartType, currentForm, live, defaultIsTable },
          `checkdecijfers.nl — ${tableId}`,
        );

  // #229 (ADR 041 addendum, session 110): when the spec's own default form
  // is Tabel, "Default" is never a real, distinct choice from "As shown" —
  // see buildEmbedCode's own `defaultIsTable` comment for why. Filtered out
  // of the rendered radios entirely rather than shown disabled: `chartType`
  // starts as `'as-shown'` (below) and this filter means the reader can
  // never select the value buildEmbedCode's own belt-and-suspenders check
  // guards against, so both layers agree by construction.
  const chartTypeOptions = defaultIsTable ? CHART_TYPE_OPTIONS.filter((ct) => ct !== 'default') : CHART_TYPE_OPTIONS;

  return (
    <ChartEditModal
      open
      onClose={onClose}
      title={t(lang, 'chart.embed.dialogTitle')}
      // Session 110 UX audit pass 3, row 7: resolved via this file's own
      // explicit `lang` prop, matching `title` right above it — never the
      // ambient LangProvider this file deliberately doesn't depend on (see
      // this file's header comment).
      closeLabel={t(lang, 'common.close')}
      chartSlot={chartSlot}
    >
      {/* Row 10 (session 110 UX audit pass 4): these two instruction
        * paragraphs describe a code block that only exists once `result`
        * resolves to a real token -- shown unconditionally, they used to sit
        * above "Insluiten is nu niet beschikbaar." with no code anywhere,
        * instructions for something that does not exist. Gated the same way
        * the code block below already is (`result !== 'unavailable'`). */}
      {result !== 'unavailable' ? (
        <>
          <p className="text-sm text-muted-foreground">{t(lang, 'chart.embed.dialogExplain')}</p>
          <p className="text-xs text-muted-foreground">{t(lang, 'chart.embed.autoResizeExplain')}</p>
          {/* Open-questions #243(b): the preview beside these controls is the
            * live on-screen chart (chart.tsx's own canvasNode/legendNode,
            * `chartSlot` above) — any Style-panel colour/font/frame changes,
            * a zoomed period, or series hidden via the legend all show up
            * here, but buildEmbedCode below only ever encodes language,
            * chart type (and only for "as shown"), and live-embed. Making
            * the two match would mean either re-deriving a second, pristine
            * render just for this preview (the no-duplicate-live-instance
            * design chart-edit-modal.tsx documents against) or teaching the
            * embed token to carry style/zoom/hidden-series state — both are
            * real design decisions, not attempted here. This line is the
            * small, honest fix: say plainly which settings do and don't
            * carry over, so the preview never reads as a promise it can't
            * keep. */}
          <p className="text-xs text-muted-foreground">{t(lang, 'chart.embed.previewCaveat')}</p>
        </>
      ) : null}

      {result === 'loading' ? <p className="text-xs text-muted-foreground">{t(lang, 'chart.embed.loading')}</p> : null}
      {/* #12 (session 110 UX audit): availability is only known AFTER this
        * round trip (EMBED_TOKEN_SECRET is a server-only check inside
        * createEmbedCode — the button has no earlier render-time signal to
        * gate on). Styled as a neutral, muted hint rather than a red
        * destructive error: the reader did nothing wrong, this is a
        * disabled-state message, not a failure they caused. */}
      {result === 'unavailable' ? <p className="text-xs text-muted-foreground">{t(lang, 'chart.embed.unavailable')}</p> : null}

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
            {chartTypeOptions.map((ct) => (
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
          {/* Row 5 (session 110 UX audit pass 2): this row used to end with a
            * SECOND "Close" button, alongside ChartEditModal's own built-in ×
            * (ui/dialog.tsx's DialogContent, `showCloseButton` default true —
            * also accessibly named "Close") — two identically-named close
            * controls in one dialog, the same shape pass 1's row 6 fixed on
            * the Style dialog. Dropped rather than relabelled, matching that
            * fix: the shell's own × is the only close control a reader needs. */}
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
          </div>
        </>
      ) : null}
    </ChartEditModal>
  );
}
