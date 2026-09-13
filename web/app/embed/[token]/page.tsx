// ADR 041 / spec Part B3: the public, no-auth embed page. Verifies the
// signed token, loads the IMMUTABLE audit row it names, and renders the
// SAME ChartView every other surface uses — embedMode strips its
// interactive chrome (Task 3), so the honesty invariants (R1/R6/R11) cover
// this render automatically, with zero new digit-token surface beyond the
// one date string this file itself builds for the footer.
//
// Live mode (Task 6, spec Part B3's "Live" branch, `?live=1`): re-runs the
// row's stored `intent` through the live query pipeline
// (src/chart/embed-live.ts's `rerunLive`) and, on success, renders the FRESH
// spec instead of the frozen one — gated on the row's OWNER being a Pro
// account, never on the anonymous visitor loading this public page.
// `rerunLive` returns null on ANY failure (malformed stored intent, a
// refusal outcome, a thrown error), and both a non-Pro owner and a failed
// live re-run fall back to the frozen render — silently for a non-Pro owner
// (spec: "a copied 'live' code stops being live when Pro lapses"), with a
// distinguishing footer message when a Pro owner's live re-run itself fails.
//
// The row's owner is resolved to an email via `lookupUserEmail`
// (src/billing/creator-email.ts, added 2026-09-12 — ADR 041 revisit trigger,
// open-questions #224) before the Pro check, so Live can now actually
// activate for an owner listed in `PRO_ACCOUNT_EMAILS`, once the owner
// verifies the lookup's read against the live project (docs/RUNBOOK.md).
//
// The minimal-layout half of spec Part B3 (no site header/footer, <html
// lang> from ?lang) is handled by web/proxy.ts + web/app/layout.tsx (fix
// round, Piece 1/2) — this file only ever owned its OWN strings (the
// footer, the not-available message).
//
// Fix round (Task 5 review, Piece 3): `?form=` — already emitted by Task 4's
// embed dialog (chart-embed-dialog.tsx) — is read and applied here.
//
// Final review (Fix 2): `?theme=` is deliberately NOT read anywhere in this
// file (any more). It used to be handled by a local `<div className="dark">`
// wrapper around the chart, which only ever flipped Tailwind's dark-mode-
// scoped tokens for markup INSIDE that div and did nothing to stop
// web/app/layout.tsx's unconditional `<ThemeProvider>` from resolving the
// READER's own OS/browser prefers-color-scheme regardless of what `?theme=`
// said — so `?theme=light` (the embed dialog's own DEFAULT option) silently
// did nothing on a dark-mode reader, and `?theme=dark` never painted the
// page's own background. Both directions are now fixed at the ROOT instead:
// web/proxy.ts validates `?theme=` into an `x-embed-theme` request header
// (only for 'light'/'dark' — 'auto' correctly sets nothing, since that means
// "follow the reader's own system preference", next-themes' own default
// behaviour with no override needed), and web/app/layout.tsx reads that
// header and passes it as `<ThemeProvider forcedTheme={...}>` — next-themes'
// own documented API for exactly this override case. See that file's own
// comment for the full mechanism and why it correctly reaches the page
// background this file's old wrapper never did.
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { loadAuditRecord } from '../../../backend/answer/audit/index.ts';
import { verifyEmbedToken } from '../../../backend/chart/embed-token.ts';
import { rerunLive } from '../../../backend/chart/embed-live.ts';
import { hasProPlan, lookupUserEmail } from '../../../backend/billing/index.ts';
import { ChartView } from '../../../components/chart.tsx';
import { getDb } from '../../../lib/db.ts';
import { isChartForm, type ChartForm } from '../../../lib/chart-view-state.ts';
import { isLang, type Lang } from '../../../lib/i18n/messages.ts';

// Per-request: the token names a different audit row on every request, so
// this can never be statically prerendered as one page — same reasoning
// (and same idiom) as web/app/login/page.tsx's own `force-dynamic`.
//
// Task 6 note: spec Part B3 asks for `export const revalidate = 3600;` on
// this file ("an hour is well inside CBS's cadence") — deliberately NOT
// added. Per Next.js's own route-segment-config docs (v16.2.9,
// caching-without-cache-components.mdx), `dynamic = 'force-dynamic'` is
// "equivalent to setting every fetch() request to... `next: { revalidate: 0 }`"
// and forces the route to be "rendered for each user at request time" — so a
// `revalidate` export alongside it would be a silent no-op, not a real
// hour-long cache, and would misleadingly imply caching that never happens.
// It would also be unsafe if that precedence ever changed: a redacted/deleted
// audit row (retention sweep) must stop rendering on the VERY NEXT request,
// on both the frozen AND live branches — an hour-long page cache would risk
// serving a since-redacted row's content for up to an hour past that sweep,
// undoing the "make /embed/[token] publicly reachable" fix round's own
// correctness guarantee. The cost this trades away is re-running the live
// query on every `?live=1` request rather than at most once an hour; that
// query is a `probe: true` read of our own already-ingested Postgres data
// (src/query/run.ts), never an external CBS call, so the real cost is one
// extra internal DB round trip per request — accepted over the alternative
// of a stale-content correctness/privacy regression on a previously-reviewed
// route. Flagged in this task's own commit/report as a deliberate deviation
// from the brief's literal instruction, not an oversight.
export const dynamic = 'force-dynamic';

// Belt-and-suspenders, same rationale and shape as
// web/app/systeemoverzicht/page.tsx's own `metadata`: the whole site is
// already blanket-noindexed via web/app/layout.tsx + web/app/robots.ts
// (Phase 0, pre-launch), but THIS page must stay noindexed even after that
// global flag is eventually lifted — a shared chart URL is for the reader
// who received the link, never a page meant to rank.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/** The retention redaction sentinel (src/answer/audit/retention.ts's
 * `redactedResponse()`) lives INSIDE the stored response envelope, not as a
 * column on `AuditRecord`. Copied byte-for-byte from
 * web/app/embed-actions.ts's `createEmbedCode` guard (itself copied from
 * scripts/verify-audit-rows.ts) rather than imported — this task's scope is
 * pinned to two files (this route + its test) and does not touch
 * embed-actions.ts. A third copy, deliberately; if the sentinel shape ever
 * changes, all three must change together. */
function isRedacted(response: unknown): boolean {
  return typeof response === 'object' && response !== null && (response as { redacted?: unknown }).redacted === true;
}

/** The exact date convention `buildAttributionLine` uses for this same kind
 * of audit timestamp (src/answer/compose/format.ts:
 * `Gegevens gesynchroniseerd op ${a.syncedAt.slice(0, 10)}`) — confirmed as
 * the intended formatter by the design spec itself (docs/superpowers/specs/
 * 2026-09-09-story-mode-and-embed-design.md, B3: "the date = the audit row's
 * createdAt, formatted by the same date formatter the attribution line
 * uses — a spec/record string, never re-derived"). A bare ISO YYYY-MM-DD
 * prefix — NOT the OTHER, locale-flavored Intl.DateTimeFormat convention
 * this codebase also has (question-history.tsx's `formatDate`, citation.ts's
 * `formatDateNl`): that one is for a different kind of date (a
 * conversational "asked on" timestamp), not this attribution-style stamp.
 * `lang` doesn't change the output — same as `buildAttributionLine`, which
 * takes no lang parameter at all: a bare ISO date reads unambiguously in
 * both nl and en, so there is nothing to localize. Kept as a parameter
 * anyway so the call site stays self-documenting about what varies by
 * language (the surrounding sentence) and what deliberately doesn't (the
 * date itself). */
function formatEmbedDate(iso: string, _lang: Lang): string {
  return iso.slice(0, 10);
}

export default async function EmbedPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  // `theme` deliberately excluded (final review, Fix 2): `?theme=` is now
  // entirely proxy.ts/layout.tsx-owned (see the file header comment) — this
  // component itself has no use for it, even though the real URL this route
  // serves legitimately carries the param.
  searchParams: Promise<{ lang?: string; form?: string; live?: string }>;
}) {
  const { token } = await params;
  const query = await searchParams;

  const secret = process.env.EMBED_TOKEN_SECRET;
  if (!secret) notFound();

  const auditId = verifyEmbedToken(token, secret);
  if (auditId === null) notFound();

  const record = await loadAuditRecord(getDb(), auditId);
  if (record === null) notFound();

  // ChartSpec (src/chart/types.ts) carries no language field of its own —
  // buildChartSpec (src/chart/build.ts) never takes a `lang`, and every
  // string it builds (attributionLine, definitionLine, nullNotes,
  // dimLabels) is unconditionally Dutch. So "the chart's own resolved
  // language" is 'nl' — not an arbitrary hardcode, but the only language the
  // chart itself is ever in.
  const lang: Lang = isLang(query.lang) ? query.lang : 'nl';

  const response = record.response;

  // Mirrors web/app/embed-actions.ts's createEmbedCode guard exactly, minus
  // the ownership check (`record.userId !== userId`) — that check doesn't
  // apply on this public route: the signed token IS the authorization, and
  // there is no "current user" to compare against.
  if (response.kind !== 'answer' || response.chart === null || isRedacted(response)) {
    return (
      <main className="flex min-h-[200px] items-center justify-center p-4 text-sm text-muted-foreground">
        {lang === 'en' ? 'This chart is no longer available.' : 'Deze grafiek is niet meer beschikbaar.'}
      </main>
    );
  }

  const spec = response.chart;
  // Session 101 (open-questions #237(b)/#205): the Pro pitch is visible to
  // every visitor of a frozen embed, not just its creator — "probably right
  // on a frozen embed's own page" per the kickoff brief. No new link: it
  // rides the SAME existing "checkdecijfers.nl" backlink right after it
  // (chart.tsx's embedFooter rendering), so this stays a plain string change
  // here rather than touching that file's own JSX. Deliberately dropped by
  // BOTH Pro branches below (a successful live re-run, and a Pro owner whose
  // live re-run failed) — pitching Pro to someone who already has it, or
  // whose chart IS live, would be nonsensical. Deliberately NO price here
  // (unlike the dialog's own `chart.embed.proPrice`): this page's own test
  // asserts every digit in the render traces to the chart spec — a real
  // fabrication guard, not one to work around — so the pitch stays digit-free.
  const footerText =
    (lang === 'en' ? 'Frozen on ' : 'Bevroren op ') +
    formatEmbedDate(record.createdAt, lang) +
    ' · ' +
    (lang === 'en' ? 'Never go stale — go Pro' : 'Nooit meer verouderd — ga Pro') +
    ' ·';

  // Task 6 (spec Part B3 "Live" branch): re-run the stored intent live, but
  // only for a Pro OWNER, never for the anonymous visitor loading this
  // public page. Both a non-Pro owner and a failed live re-run fall back to
  // `spec`/`footerText` (the frozen render computed above) — never a broken
  // or blank page.
  let finalSpec = spec;
  let finalFooter = footerText;

  if (query.live === '1') {
    // The Pro gate checks the audit row's OWNER (`record.userId`), never the
    // anonymous visitor — an embed URL can be viewed by anyone, but "Live" is
    // a privilege of whoever CREATED it. `hasProPlan({ id, email })`
    // (src/billing/pro.ts) can only ever match by EMAIL, and the only
    // email-by-user-id lookup this codebase has is `currentUserEmail()`
    // (web/lib/current-user.ts), which reads the CURRENT session's own JWT
    // claims — not an arbitrary OTHER user's (mirrors
    // web/app/embed-actions.ts's `createEmbedCode`, which computes this same
    // `pro` flag at MINT time via `hasProPlan({ id: userId, email:
    // currentUserEmail() })` — that call has a live session to read the
    // email from; this one, rendering days later for an anonymous visitor,
    // does not).
    //
    // 2026-09-12 (ADR 041 revisit trigger, open-questions #224, design note
    // docs/session-briefs/2026-09-12-live-embed-creator-lookup-design.md):
    // resolved via `lookupUserEmail` (src/billing/creator-email.ts), which
    // reads `auth.users.email` through this app's EXISTING pg pool
    // (DATABASE_URL — the same Supabase Postgres project GoTrue's own auth
    // schema lives in) rather than a new Supabase admin/service-role client
    // (a new privileged secret) or a mirrored+trigger-synced email column (a
    // schema change and a second copy of personal data). It fails closed to
    // `null` on ANY error — no `auth` schema, denied privilege, an unknown
    // or malformed id — so an unverified or denied read degrades to exactly
    // this gate's prior always-frozen behaviour, never a thrown error.
    // **Assumption (unverified against the live project by this change —
    // see docs/RUNBOOK.md's "verify the pooler role can read auth.users"
    // step):** the pooler role backing DATABASE_URL can SELECT from
    // `auth.users`; on Supabase the `postgres` role normally can. Until the
    // owner confirms this on production, Live still stays frozen — nothing
    // breaks either way. A row with no owner (`record.userId === null`,
    // e.g. a benchmark/anonymous row) never needs a lookup at all.
    const email = record.userId === null ? null : await lookupUserEmail(getDb(), record.userId);
    const pro = hasProPlan({ id: record.userId ?? '', email });
    if (pro) {
      const liveSpec = await rerunLive(getDb(), record, { lang });
      if (liveSpec !== null) {
        finalSpec = liveSpec;
        finalFooter =
          (lang === 'en' ? 'Live · data as of ' : 'Live · gegevens van ') +
          formatEmbedDate(liveSpec.attribution.syncedAt, lang) +
          ' ·';
      } else {
        finalFooter =
          (lang === 'en'
            ? 'Live update not available, showing the chart of '
            : 'Live-update niet beschikbaar, dit is de grafiek van ') +
          formatEmbedDate(record.createdAt, lang) +
          '.';
      }
    }
    // pro === false: silently fall back to the frozen spec/footer already
    // computed above — no distinguishing message (spec: "a copied 'live'
    // code stops being live when Pro lapses").
  }

  // Fix round (Task 5 review, Piece 3): `?form=`, validated with the real
  // isChartForm guard — never trusted raw. ChartView's own
  // lineFormAllowed/areaFormAllowed/hbarFormAllowed guards (applied inside
  // its initialFormOverride effect) are the SECOND, spec-aware check; this
  // one only confirms the string names a real ChartForm at all.
  //
  // Final review (Bundle B): 'table' is excluded here explicitly even though
  // isChartForm accepts it (it IS a real ChartForm member) and even though
  // ChartView's own initialFormOverride effect never gates it either
  // ('bar'/'table' are "never gated", by that effect's own design/comment).
  // This plan's own spec says table form is never embeddable — the embed
  // dialog's own Embed button is hidden whenever state.form === 'table', so
  // the dialog itself can never GENERATE a `?form=table` URL — but nothing
  // stopped a hand-crafted one from reaching this public route and
  // rendering the Tabel view anyway, before this guard.
  const formOverride: ChartForm | undefined =
    isChartForm(query.form) && query.form !== 'table' ? query.form : undefined;

  const chartView = (
    <ChartView
      spec={finalSpec}
      frameless
      embedMode
      embedFooter={finalFooter}
      initialFormOverride={formOverride}
    />
  );

  // Final review (Fix 2): the old `<div className="dark">` wrapper (keyed
  // on `?theme=dark`) is gone — see the file header comment for why, and
  // web/proxy.ts + web/app/layout.tsx for where that responsibility now
  // lives (the `x-embed-theme` request header -> `<ThemeProvider
  // forcedTheme={...}>`, applied at the root, not per-route here).
  return <main className="p-2">{chartView}</main>;
}
