// ADR 041 / spec Part B3: the public, no-auth embed page. Verifies the
// signed token, loads the IMMUTABLE audit row it names, and renders the
// SAME ChartView every other surface uses — embedMode strips its
// interactive chrome (Task 3), so the honesty invariants (R1/R6/R11) cover
// this render automatically, with zero new digit-token surface beyond the
// one date string this file itself builds for the footer.
//
// Scope note (Task 5 is the FROZEN branch only): `?live=1` (spec Part B3's
// "Live" branch, re-running the stored intent through a fresh query — Task
// 6) is intentionally never read here. `?theme=`/`?form=` and the spec's
// "<html lang> from ?lang" minimal layout are also out of this task's
// two-file scope (this route + its test) — `lang` below drives only this
// file's OWN strings (the footer, the not-available message).
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { loadAuditRecord } from '../../../backend/answer/audit/index.ts';
import { verifyEmbedToken } from '../../../backend/chart/embed-token.ts';
import { ChartView } from '../../../components/chart.tsx';
import { getDb } from '../../../lib/db.ts';
import { isLang, type Lang } from '../../../lib/i18n/messages.ts';

// Per-request: the token names a different audit row on every request, so
// this can never be statically prerendered as one page — same reasoning
// (and same idiom) as web/app/login/page.tsx's own `force-dynamic`.
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
  searchParams: Promise<{ lang?: string; theme?: string; form?: string; live?: string }>;
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
  const footerText =
    (lang === 'en' ? 'Frozen on ' : 'Bevroren op ') + formatEmbedDate(record.createdAt, lang) + ' ·';

  return (
    <main className="p-2">
      <ChartView spec={spec} frameless embedMode embedFooter={footerText} />
    </main>
  );
}
