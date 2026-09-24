// ADR 057 (session 127) / spec §2, §3.3: the public, no-auth embed page for
// an own-data chart someone published from their own uploaded file — the
// own-data twin of web/app/embed/[token]/page.tsx (that file's own header
// comment explains the CBS-tier mechanism this mirrors: verify → load the
// immutable record it names → render the SAME card every other surface
// uses). The differences from that route are all in WHAT it loads and HOW
// it authorizes:
//   - authorization is a saved row (publications.ts), not a signed token —
//     the spec's own §1.3 rationale is that a signed link could only ever
//     publish the chart as first made and could only be taken down by
//     deleting the whole file, which is fine for public CBS data but not
//     for a person's own data. Unpublish (a hard delete of the row,
//     own-chart-publish-actions.ts) makes the link die at once.
//   - the chart itself is rebuilt server-side by REPLAYING the author's
//     saved command log against the dataset (`buildPublishedChart`,
//     web/lib/own-chart-publication.ts) and then PRUNED
//     (`pruneForPublic`) before anything reaches this module's JSX —
//     that pruning step is invariant P1's single enforcement point
//     (docs/05-data-rules.md): a hidden series' label/value/source text,
//     the file name, the source URL host, the content hash, the raw cells/
//     profile and the command log itself must never reach an anonymous
//     visitor. Neither function is duplicated or re-implemented here — U1/
//     U5/U6 hold by reuse, the same discipline ADR 041 leans on for the CBS
//     tier.
//   - there is no Live branch (U12: an uploaded file never changes) and no
//     `?form=`/`?theme=` handling of its own: `?theme=` is already fully
//     proxy.ts/layout.tsx-owned for every `/embed/`-prefixed path
//     (embedRequestHeaders matches on the pathname prefix, not a specific
//     route), exactly as the CBS route's own file header explains for
//     itself, and own-data's read-only card has no form-tab affordance to
//     override in the first place (spec §3.6: "no form tabs").
//
// Error handling: unlike the initial brief's default posture, this file
// verified the CBS route's ACTUAL behaviour (its own page.tsx) before
// writing this one — loadAuditRecord/hasProPlan/lookupUserEmail/rerunLive
// are all awaited there with no try/catch of any kind, so a thrown DB error
// propagates to Next's own route-level error boundary rather than being
// caught and turned into the "not available" page. This file follows that
// same, already-reviewed precedent for its own DB reads
// (getPublicationByPublicId/getDatasetTurnById/getDataset/
// buildPublishedChart) — deliberately NOT wrapping them in a try/catch —
// with ONE carried-over exception: the account-style lookup (Task 4's
// review finding) gets its own try/catch, because a failure there is
// explicitly meant to degrade to "no default look" rather than take the
// whole page down, unlike every other read on this page which names a
// piece of content the visitor cannot see a sensible page without.
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getPublicationByPublicId, isPublicIdShape } from '../../../../backend/attachments/publications.ts';
import { getDatasetTurnById } from '../../../../backend/attachments/read.ts';
import { getDataset } from '../../../../backend/attachments/store.ts';
import { chartStylesTablePresent, getUserChartStyle } from '../../../../backend/chart/user-styles.ts';
import { buildPublishedChart, firstRenderMatchesEnvelope, pruneForPublic } from '../../../../lib/own-chart-publication.ts';
import { UserChartView } from '../../../../components/user-chart.tsx';
import { getDb } from '../../../../lib/db.ts';
import { isLang, t, type Lang } from '../../../../lib/i18n/messages.ts';
import { EmbedResize } from '../../[token]/embed-resize.tsx';

// Per-request, same reasoning as web/app/embed/[token]/page.tsx's own
// `force-dynamic`: the publicId names a different (or since-unpublished/
// since-deleted) row on every request, and a redaction/unpublish must stop
// rendering on the VERY NEXT request — a cached page would risk serving a
// since-unpublished chart's content past that point.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Same belt-and-suspenders posture as the CBS embed route: the whole site is
// already blanket-noindexed pre-launch, but a shared chart URL is for the
// reader who received the link, never a page meant to rank, so this stays
// noindexed even once that global flag is eventually lifted.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// Same fallback expression every other file in this app that needs the
// app's own public origin re-declares locally (web/app/embed-actions.ts,
// web/app/credits/actions.ts) rather than importing chart-embed-dialog.tsx's
// exported `APP_URL` — that file is a 'use client' component whose own
// imports (embed-actions.ts's Server Actions, the dialog UI) have no reason
// to be dragged into this server route just for one constant.
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://checkdecijfers.nl';

function NotAvailable({ lang }: { lang: Lang }) {
  return (
    <>
      <EmbedResize />
      <main className="flex min-h-[200px] items-center justify-center p-4 text-sm text-muted-foreground">
        {t(lang, 'ownChart.public.unavailable')}
      </main>
    </>
  );
}

export default async function OwnEmbedPage({
  params,
  searchParams,
}: {
  params: Promise<{ publicId: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { publicId } = await params;
  const query = await searchParams;
  const lang: Lang = isLang(query.lang) ? query.lang : 'nl';

  if (process.env.OWN_DATA_PUBLISH_ENABLED !== '1') notFound();
  if (!isPublicIdShape(publicId)) notFound();

  const db = getDb();

  const row = await getPublicationByPublicId(db, publicId);
  if (row === null) return <NotAvailable lang={lang} />;

  const turn = await getDatasetTurnById(db, row.datasetTurnId);
  // R2: besides the turn simply not existing, a turn whose OWNER or whose
  // OWN datasetId disagrees with the publication row's must also refuse —
  // the same defence-in-depth own-chart-publish-actions.ts's own publish
  // path applies (`dataset.id !== turn.datasetId`) against the two ever
  // silently drifting apart, applied here on the READ side too.
  if (turn === null || turn.userId !== row.userId || turn.datasetId !== row.datasetId) {
    return <NotAvailable lang={lang} />;
  }

  // Loaded by the AUTHOR's own id (row.userId), never an anonymous
  // visitor's — there is no "current user" on this public route to scope by.
  const dataset = await getDataset(db, row.userId, row.datasetId);
  if (dataset === null || dataset.status !== 'ready') {
    return <NotAvailable lang={lang} />;
  }

  // Covers a redacted turn too, without a separate check: retention.ts's
  // redactTurnsForDatasets nulls `instruction` for every redacted turn
  // regardless of kind, and buildPublishedChart already refuses a null
  // instruction as `not_chart` — the same "not ok -> not-available" branch
  // every other refusal reason falls into below. (In practice a redacted
  // turn's publication row is also hard-deleted in that SAME transaction —
  // publications.ts's deletePublicationsForTurns — so this is defence in
  // depth for the narrow window a purge job or manual deletion misses it,
  // not the primary mechanism.)
  const built = buildPublishedChart(dataset, turn, row.log);
  if (!built.ok) return <NotAvailable lang={lang} />;

  // Final-review fix A2 (ruling R12) — fail closed. A stored log that no
  // longer fully replays (`dropped > 0`: a later code change made one of its
  // commands invalid for this chart) would render a chart that differs from
  // what the author published — possibly WITHOUT a `toggleSeries` that hid a
  // series they meant to keep private. The publish action already refuses a
  // nonzero drop count at write time; the read path now refuses it too.
  if (built.dropped > 0) return <NotAvailable lang={lang} />;

  // Final-review fix A3 (ruling R16) — code-drift guard: series keys in the
  // log are positional (s0, s1, ...), so they only mean what they meant at
  // publish time if the turn's first render still names the same series in
  // the same order as the chart the turn stored (own-chart-publication.ts's
  // `firstRenderMatchesEnvelope`). A mismatch refuses rather than risk
  // hiding the wrong series.
  if (!firstRenderMatchesEnvelope(dataset, turn)) return <NotAvailable lang={lang} />;

  const pub = pruneForPublic(built, row.sourceLine);

  // Carried from Task 4's review: a style-load failure must not break the
  // page — render without the author's saved look rather than falling
  // through to not-available or letting the failure propagate, unlike every
  // other read on this page.
  let accountStyle: unknown = null;
  try {
    if (await chartStylesTablePresent(db)) {
      const styleRow = await getUserChartStyle(db, row.userId);
      accountStyle = styleRow?.style ?? null;
    }
  } catch {
    // C1: logged, never swallowed silently — a short fixed message and no
    // payload (the error object could carry connection details or row
    // content; the visitor-facing page must not depend on it either way).
    console.error('own-data embed: author chart style lookup failed; rendering without it');
    accountStyle = null;
  }

  return (
    <>
      <EmbedResize />
      <main className="p-2">
        <UserChartView
          spec={pub.spec}
          publicView={{
            state: pub.state,
            overlays: pub.overlays,
            sourceLine: pub.sourceLine,
            accountStyle,
          }}
        />
      </main>
      <footer className="p-2 text-xs text-muted-foreground">
        <a href={APP_URL} target="_blank" rel="noopener" className="underline">
          {t(lang, 'ownChart.public.footer')}
        </a>
      </footer>
    </>
  );
}
