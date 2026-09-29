// WP-LOOK part (a2) (session 143, 2026-09-29, open-questions #351): the Open
// Graph image of a shared chart. Next's file convention wires this route's
// PNG into the embed page's <meta property="og:image"> / twitter:image, so a
// Share link (`/embed/<token>?…`, chart-share-button.tsx) unfurls with a
// picture of the chart wherever it is pasted. The card is built by the pure
// module web/lib/share-preview.tsx; this file only resolves the token and
// rasterises. A token that resolves to nothing gets the neutral brand card —
// a valid PNG with not a single digit, never a 404 body a platform would
// show as a broken image.
//
// Node runtime on purpose (Fluid Compute): resvg/yoga run fine there and the
// audit read goes through the same db client as the page.
import { ImageResponse } from 'next/og';
import {
  buildSharePreview,
  NeutralPreviewCard,
  SHARE_PREVIEW_SIZE,
  SharePreviewCard,
} from '../../../lib/share-preview.tsx';
import { loadEmbedChart } from './embed-chart.ts';

export const runtime = 'nodejs';
export const size = SHARE_PREVIEW_SIZE;
export const contentType = 'image/png';
export const alt = 'Grafiek van checkdecijfers.nl';

export default async function Image({ params }: { params: Promise<{ token: string }> }): Promise<ImageResponse> {
  const { token } = await params;
  const chart = await loadEmbedChart(token).catch(() => null);
  // A stored spec the renderer refuses (a future schema version, say) must
  // degrade to the neutral card too — a thrown error here is a broken image
  // on every platform that unfurled the link.
  const model = chart === null ? null : safeBuild(chart.spec, chart.headlineText);
  const element = model === null ? <NeutralPreviewCard /> : <SharePreviewCard model={model} />;
  return new ImageResponse(element, { width: size.width, height: size.height });
}

function safeBuild(spec: Parameters<typeof buildSharePreview>[0], headlineText: string | null) {
  try {
    return buildSharePreview(spec, headlineText);
  } catch (error) {
    console.warn('[share-preview] card build failed, serving the neutral card:', error instanceof Error ? error.message : error);
    return null;
  }
}
