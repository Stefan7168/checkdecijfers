// Task 3 (design §C2): ChartFrame's own rendering rules, in isolation from
// ChartView. chart.test.tsx covers the WIRING (frameImage state, the export
// container being the only thing wrapped, digit-scan safety, story
// interplay) — this file is purely "given these FrameValues, what CSS comes
// out".
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { ChartFrame, CHART_MIN_HEIGHT_PX } from './chart-frame.tsx';
import {
  FRAME_CORNER_PX,
  FRAME_GRADIENT_ANGLE,
  FRAME_INSET_PX,
  FRAME_PADDING_PX,
  FRAME_SHADOW,
  STOCK_PRESENTATION,
  type FrameValues,
} from '../lib/chart-presentation.ts';

function frame(overrides: Partial<FrameValues> = {}): FrameValues {
  return {
    frameBackground: STOCK_PRESENTATION.frameBackground,
    framePadding: STOCK_PRESENTATION.framePadding,
    frameCorners: STOCK_PRESENTATION.frameCorners,
    frameShadow: STOCK_PRESENTATION.frameShadow,
    frameInset: STOCK_PRESENTATION.frameInset,
    frameAspect: STOCK_PRESENTATION.frameAspect,
    ...overrides,
  };
}

describe('ChartFrame', () => {
  it('pristine, no image: a bare wrapper div with no inline style — byte-identical to no frame at all', () => {
    const { container } = render(
      <ChartFrame frame={frame()} image={null}>
        <div>chart</div>
      </ChartFrame>,
    );
    const wrapper = container.querySelector('[data-slot="chart-frame"]');
    expect(wrapper).not.toBeNull();
    expect(wrapper!.getAttribute('style')).toBeNull();
  });

  it('solid background → background-color', () => {
    const { container } = render(
      <ChartFrame frame={frame({ frameBackground: { kind: 'solid', hex: '#336699' } })} image={null}>
        <div>chart</div>
      </ChartFrame>,
    );
    const wrapper = container.querySelector('[data-slot="chart-frame"]') as HTMLElement;
    expect(wrapper.style.backgroundColor).toBe('rgb(51, 102, 153)');
  });

  it('gradient background → background-image: linear-gradient(135deg, from, to)', () => {
    const { container } = render(
      <ChartFrame frame={frame({ frameBackground: { kind: 'gradient', from: '#fde68a', to: '#f472b6' } })} image={null}>
        <div>chart</div>
      </ChartFrame>,
    );
    const wrapper = container.querySelector('[data-slot="chart-frame"]') as HTMLElement;
    expect(wrapper.style.backgroundImage).toBe(`linear-gradient(${FRAME_GRADIENT_ANGLE}deg, rgb(253, 230, 138), rgb(244, 114, 182))`);
  });

  it('image background with a data URL → background-image: url(...), cover, center', () => {
    const dataUrl = 'data:image/png;base64,AAA';
    const { container } = render(
      <ChartFrame frame={frame({ frameBackground: { kind: 'image' } })} image={dataUrl}>
        <div>chart</div>
      </ChartFrame>,
    );
    const wrapper = container.querySelector('[data-slot="chart-frame"]') as HTMLElement;
    expect(wrapper.style.backgroundImage).toBe(`url("${dataUrl}")`);
    expect(wrapper.style.backgroundSize).toBe('cover');
    expect(wrapper.style.backgroundPosition).toBe('center center');
  });

  it('image background with image === null is treated as none — no background-image', () => {
    const { container } = render(
      <ChartFrame frame={frame({ frameBackground: { kind: 'image' } })} image={null}>
        <div>chart</div>
      </ChartFrame>,
    );
    const wrapper = container.querySelector('[data-slot="chart-frame"]') as HTMLElement;
    expect(wrapper.style.backgroundImage).toBe('');
  });

  it('padding and corners map onto the px maps from chart-presentation.ts', () => {
    const { container } = render(
      <ChartFrame frame={frame({ framePadding: 'large', frameCorners: 'veryRounded', frameBackground: { kind: 'solid', hex: '#000000' } })} image={null}>
        <div>chart</div>
      </ChartFrame>,
    );
    const wrapper = container.querySelector('[data-slot="chart-frame"]') as HTMLElement;
    expect(wrapper.style.padding).toBe(`${FRAME_PADDING_PX.large}px`);
    expect(wrapper.style.borderRadius).toBe(`${FRAME_CORNER_PX.veryRounded}px`);
  });

  it('shadow builds box-shadow from FRAME_SHADOW', () => {
    const { container } = render(
      <ChartFrame frame={frame({ frameShadow: 'strong', frameBackground: { kind: 'solid', hex: '#000000' } })} image={null}>
        <div>chart</div>
      </ChartFrame>,
    );
    const wrapper = container.querySelector('[data-slot="chart-frame"]') as HTMLElement;
    const s = FRAME_SHADOW.strong!;
    expect(wrapper.style.boxShadow).toBe(`${s.dx}px ${s.dy}px ${s.blur}px rgba(0, 0, 0, ${s.alpha})`);
  });

  it('inset renders an inner card with padding, background: var(--card), and the same corner radius', () => {
    const { container } = render(
      <ChartFrame frame={frame({ frameInset: 'large', frameCorners: 'rounded', frameBackground: { kind: 'solid', hex: '#000000' } })} image={null}>
        <div>chart</div>
      </ChartFrame>,
    );
    const card = container.querySelector('[data-slot="chart-frame-card"]') as HTMLElement;
    expect(card).not.toBeNull();
    expect(card.style.padding).toBe(`${FRAME_INSET_PX.large}px`);
    expect(card.style.background).toBe('var(--card)');
    expect(card.style.borderRadius).toBe(`${FRAME_CORNER_PX.rounded}px`);
    expect(card.textContent).toBe('chart');
  });

  it('no inset renders no inner card — children sit directly in the outer div', () => {
    const { container } = render(
      <ChartFrame frame={frame({ frameBackground: { kind: 'solid', hex: '#000000' } })} image={null}>
        <div>chart</div>
      </ChartFrame>,
    );
    expect(container.querySelector('[data-slot="chart-frame-card"]')).toBeNull();
  });

  it('aspect ratio: no CSS aspect-ratio (it broke width on narrow cards); the ratio is recorded and the child area stretches with flex', () => {
    const { container } = render(
      <ChartFrame frame={frame({ frameAspect: '16:9' })} image={null}>
        <div>chart</div>
      </ChartFrame>,
    );
    const wrapper = container.querySelector('[data-slot="chart-frame"]') as HTMLElement;
    expect(wrapper.style.aspectRatio).toBe('');
    expect(wrapper.getAttribute('data-frame-aspect')).toBe(String(16 / 9));
    expect(wrapper.style.display).toBe('flex');
    expect(wrapper.style.flexDirection).toBe('column');
    expect(wrapper.querySelector('.flex-1')).not.toBeNull();
  });

  it('an aspect ratio never shrinks the chart below its normal height: min-height = chart height + padding + inset', () => {
    const { container } = render(
      <ChartFrame frame={frame({ frameAspect: '1.91:1', framePadding: 'large', frameInset: 'small' })} image={null}>
        <div>chart</div>
      </ChartFrame>,
    );
    const wrapper = container.querySelector('[data-slot="chart-frame"]') as HTMLElement;
    expect(wrapper.style.minHeight).toBe(`${CHART_MIN_HEIGHT_PX + 2 * (FRAME_PADDING_PX.large + FRAME_INSET_PX.small)}px`);
    // …and never grows sideways past the card to keep the ratio.
    expect(wrapper.style.width).toBe('100%');
    expect(wrapper.style.maxWidth).toBe('100%');
    expect(wrapper.style.minWidth).toBe('0px');
  });

  it('auto aspect (default) sets no aspect-ratio style', () => {
    const { container } = render(
      <ChartFrame frame={frame({ frameBackground: { kind: 'solid', hex: '#000000' } })} image={null}>
        <div>chart</div>
      </ChartFrame>,
    );
    const wrapper = container.querySelector('[data-slot="chart-frame"]') as HTMLElement;
    expect(wrapper.style.aspectRatio).toBe('');
  });
});
