// Task 3 (design §C2): the frame around the chart ON SCREEN. Pure
// presentation over the six frame values already resolved by
// `resolvePresentation` (Task 1, chart-presentation.ts) — this component
// reads the px maps and shadow spec from there so no frame literal is ever
// duplicated here.
import { useRef, type CSSProperties, type ReactNode } from 'react';
import {
  CHART_MIN_HEIGHT_PX,
  FRAME_CORNER_PX,
  FRAME_GRADIENT_ANGLE,
  FRAME_INSET_PX,
  FRAME_PADDING_PX,
  FRAME_SHADOW,
  frameAspectRatio,
  isFramePristine,
  type FrameValues,
} from '../lib/chart-presentation.ts';
import { useElementWidth } from '../lib/use-element-width.ts';

// chart.tsx's `h-64` — now the FLOOR of chart.tsx's 256-360px
// height-follows-width rule (`chartHeightForWidth`, ADR 042), which a frame
// aspect ratio may never undercut. Re-exported here since it now lives in
// chart-presentation.ts alongside chartHeightForWidth, but
// chart-frame.test.tsx still imports it from this module.
export { CHART_MIN_HEIGHT_PX };

function backgroundStyle(frame: FrameValues, image: string | null): Pick<CSSProperties, 'backgroundColor' | 'backgroundImage' | 'backgroundSize' | 'backgroundPosition'> {
  const bg = frame.frameBackground;
  if (bg === 'none') return {};
  if (bg.kind === 'solid') return { backgroundColor: bg.hex };
  if (bg.kind === 'gradient') return { backgroundImage: `linear-gradient(${FRAME_GRADIENT_ANGLE}deg, ${bg.from}, ${bg.to})` };
  // bg.kind === 'image': with no image data yet (nothing chosen/uploaded),
  // this renders as if the background were 'none' — the interface note in
  // the task brief ("`{ kind: 'image' }` with `image === null` → treated as
  // none").
  if (image === null) return {};
  return { backgroundImage: `url("${image}")`, backgroundSize: 'cover', backgroundPosition: 'center' };
}

/** `ChartFrame` renders `<div data-slot="chart-frame">` around `children` —
 * the export container, and only it (chart.tsx). A pristine frame with no
 * image renders a bare wrapper div with no inline style at all, so today's
 * layout (no frame feature yet) stays byte-identical. */
export function ChartFrame({ frame, image, children }: { frame: FrameValues; image: string | null; children: ReactNode }): ReactNode {
  // Battle test rounds 1–4 (session 92, Playwright on production): CSS
  // `aspect-ratio` on the frame was wrong in every combination tried — it
  // either shrank the chart to a few dozen px (ratio × narrow card), grew the
  // frame sideways past the card, or widened the whole card past a phone's
  // screen (the ratio feeds the box's intrinsic width). So the ratio is now
  // applied to the HEIGHT only, from the frame's MEASURED width: height =
  // max(the chart's normal height + padding + inset, width ÷ ratio). The width
  // is always the card's; the export honours the exact ratio by widening its
  // own canvas (chart-download.tsx), never by cropping. Border-box width
  // (excludes the frame's own padding, which skewed the ratio by the
  // padding on both sides — battle test round 5): ADR 042's shared
  // useElementWidth hook.
  const ref = useRef<HTMLDivElement>(null);
  const aspect = frameAspectRatio(frame.frameAspect);
  const measuredWidth = useElementWidth(ref, aspect !== null);

  if (isFramePristine(frame)) {
    return <div data-slot="chart-frame">{children}</div>;
  }

  const corner = FRAME_CORNER_PX[frame.frameCorners];
  const shadow = FRAME_SHADOW[frame.frameShadow];
  const naturalHeight = CHART_MIN_HEIGHT_PX + 2 * (FRAME_PADDING_PX[frame.framePadding] + FRAME_INSET_PX[frame.frameInset]);

  const outerStyle: CSSProperties = {
    padding: FRAME_PADDING_PX[frame.framePadding],
    borderRadius: corner,
    boxShadow: shadow ? `${shadow.dx}px ${shadow.dy}px ${shadow.blur}px rgba(0, 0, 0, ${shadow.alpha})` : undefined,
    ...backgroundStyle(frame, image),
    ...(aspect !== null
      ? {
          width: '100%',
          maxWidth: '100%',
          minWidth: 0,
          boxSizing: 'border-box',
          // An explicit HEIGHT (not min-height): chart.tsx's container is
          // `h-full` inside this box, and a percentage height resolves only
          // against a definite height — with min-height alone the chart
          // collapsed to nothing (battle test round 6).
          height: Math.max(naturalHeight, Math.round(measuredWidth / aspect)),
          display: 'flex',
          flexDirection: 'column',
        }
      : {}),
  };

  const inset = FRAME_INSET_PX[frame.frameInset];
  const childArea = aspect !== null ? <div className="flex min-h-0 flex-1 flex-col">{children}</div> : children;

  if (frame.frameInset === 'none') {
    return (
      <div ref={ref} data-slot="chart-frame" data-frame-aspect={aspect ?? undefined} style={outerStyle}>
        {childArea}
      </div>
    );
  }

  return (
    <div ref={ref} data-slot="chart-frame" data-frame-aspect={aspect ?? undefined} style={outerStyle}>
      <div
        data-slot="chart-frame-card"
        style={{
          padding: inset,
          background: 'var(--card)',
          borderRadius: corner,
          ...(aspect !== null ? { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } : {}),
        }}
      >
        {childArea}
      </div>
    </div>
  );
}
