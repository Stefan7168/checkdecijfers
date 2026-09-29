// WP-LOOK part (a2) — the picture of a shared chart (session 143, open-
// questions #351; round 2 session 144). The embed page's `generateMetadata`
// points `og:image` / `twitter:image` here, so a Share link (`/embed/<token>?…`,
// chart-share-button.tsx) unfurls with this PNG wherever it is pasted; the
// card's Download menu offers the same PNG as a file (`?download=1`).
//
// Round 2 moved this from Next's `opengraph-image` file convention to a
// route handler for one reason: the convention gets no query string, and the
// reader's chosen form (`?form=`) has to reach the renderer. The card is
// built by the pure module web/lib/share-preview.tsx; this file resolves the
// token, picks the form, loads the fonts and rasterises. A token that
// resolves to nothing gets the neutral brand card — a valid PNG with not a
// single digit, never a 404 body a platform would show as a broken image.
//
// Node runtime on purpose (Fluid Compute): the audit read goes through the
// same db client as the page and the fonts are read from disk.
import { ImageResponse } from 'next/og';
import type { NextRequest } from 'next/server';
import {
  buildSharePreview,
  NeutralPreviewCard,
  previewFormFor,
  SHARE_PREVIEW_SIZE,
  SharePreviewCard,
} from '../../../../lib/share-preview.tsx';
import { loadPreviewFonts } from '../../../../lib/share-preview-fonts.ts';
import { loadEmbedChart } from '../embed-chart.ts';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  const query = request.nextUrl.searchParams;
  const chart = await loadEmbedChart(token).catch(() => null);
  // A stored spec the renderer refuses (a future schema version, say) must
  // degrade to the neutral card too — a thrown error here is a broken image
  // on every platform that unfurled the link.
  const model = chart === null ? null : safeBuild(chart.spec, chart.headlineText, query.get('form'));
  const element = model === null ? <NeutralPreviewCard /> : <SharePreviewCard model={model} />;
  const headers: Record<string, string> = {
    // The answer behind a token is frozen (an audit row), but it can be
    // redacted later (a purge, #189) — one hour at the CDN, the same bound
    // the embed page's own design set (spec Part B3), so a redacted chart's
    // picture is gone within the hour, not the day (code-review finding).
    'Cache-Control': 'public, max-age=0, s-maxage=3600',
  };
  if (query.get('download') === '1') {
    const base = model === null ? 'graphmaker' : `graphmaker-${chart!.spec.attribution.tableId}`;
    headers['Content-Disposition'] = `attachment; filename="${base}-deelafbeelding.png"`;
  }
  // The fonts are the one thing that may fail on a misconfigured host; the
  // image tool then falls back to its bundled face rather than to no image.
  const fonts = await loadPreviewFonts().catch((err: unknown) => {
    console.warn('[share-preview] fonts unavailable, using the fallback face:', err instanceof Error ? err.message : err);
    return undefined;
  });
  return new ImageResponse(element, { width: SHARE_PREVIEW_SIZE.width, height: SHARE_PREVIEW_SIZE.height, fonts, headers });
}

function safeBuild(spec: Parameters<typeof buildSharePreview>[0], headlineText: string | null, form: string | null) {
  try {
    return buildSharePreview(spec, headlineText, previewFormFor(form));
  } catch (error) {
    console.warn('[share-preview] card build failed, serving the neutral card:', error instanceof Error ? error.message : error);
    return null;
  }
}
