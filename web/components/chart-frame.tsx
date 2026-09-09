// Task 3 (design §C2): the frame around the chart ON SCREEN. Pure
// presentation over the six frame values already resolved by
// `resolvePresentation` (Task 1, chart-presentation.ts) — this component
// reads the px maps and shadow spec from there so no frame literal is ever
// duplicated here.
import type { CSSProperties, ReactNode } from 'react';
import {
  FRAME_CORNER_PX,
  FRAME_GRADIENT_ANGLE,
  FRAME_INSET_PX,
  FRAME_PADDING_PX,
  FRAME_SHADOW,
  frameAspectRatio,
  isFramePristine,
  type FrameValues,
} from '../lib/chart-presentation.ts';

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
  if (isFramePristine(frame)) {
    return <div data-slot="chart-frame">{children}</div>;
  }

  const corner = FRAME_CORNER_PX[frame.frameCorners];
  const shadow = FRAME_SHADOW[frame.frameShadow];
  const aspect = frameAspectRatio(frame.frameAspect);

  const outerStyle: CSSProperties = {
    padding: FRAME_PADDING_PX[frame.framePadding],
    borderRadius: corner,
    boxShadow: shadow ? `${shadow.dx}px ${shadow.dy}px ${shadow.blur}px rgba(0, 0, 0, ${shadow.alpha})` : undefined,
    ...backgroundStyle(frame, image),
    ...(aspect !== null ? { aspectRatio: String(aspect), display: 'flex', flexDirection: 'column' } : {}),
  };

  const inset = FRAME_INSET_PX[frame.frameInset];
  const childArea = aspect !== null ? <div className="flex min-h-0 flex-1 flex-col">{children}</div> : children;

  if (frame.frameInset === 'none') {
    return (
      <div data-slot="chart-frame" style={outerStyle}>
        {childArea}
      </div>
    );
  }

  return (
    <div data-slot="chart-frame" style={outerStyle}>
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
