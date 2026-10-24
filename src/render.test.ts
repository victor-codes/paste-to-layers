import { describe, expect, it } from 'vitest';
import { closestStyle, fitExtent, gradientPaint, imageAdjustments, imageBox, parseStyleName, placeGridItems, radialRadii } from './render';

describe('font style names', () => {
  it('reads weights regardless of spacing', () => {
    expect(parseStyleName('Extra Bold')).toEqual({ weight: 800, italic: false });
    expect(parseStyleName('ExtraBold')).toEqual({ weight: 800, italic: false });
    expect(parseStyleName('SemiBold Italic')).toEqual({ weight: 600, italic: true });
    expect(parseStyleName('Italic')).toEqual({ weight: 400, italic: true });
    expect(parseStyleName('Condensed Bold')).toBeNull();
  });

  it('matches a Google-style family for a CSS weight', () => {
    const interTight = ['Thin', 'Light', 'Regular', 'Medium', 'SemiBold', 'Bold', 'ExtraBold', 'Black', 'Italic', 'ExtraBold Italic'];
    expect(closestStyle(interTight, 800, false)).toBe('ExtraBold');
    expect(closestStyle(interTight, 600, false)).toBe('SemiBold');
    expect(closestStyle(interTight, 800, true)).toBe('ExtraBold Italic');
  });

  it('falls back to the nearest weight', () => {
    expect(closestStyle(['Regular', 'Bold'], 600, false)).toBe('Bold');
    expect(closestStyle(['Regular', 'Bold'], 300, false)).toBe('Regular');
    expect(closestStyle(['Regular', 'Bold'], 700, true)).toBe('Bold');
  });
});

describe('sizing a root from absolute children', () => {
  it('uses px insets directly', () => {
    expect(fitExtent(20, 0, 0, 0, 100)).toBe(120);
  });

  it('fits a centred child (calc(50%) + translate -50%)', () => {
    expect(fitExtent(0, 0.5, 0, -0.5, 710)).toBe(710);
  });

  it('keeps an off-centre child inside', () => {
    // left: calc(50% - 7.5px), translate -50%, 383 wide: both edges must stay in the parent.
    expect(fitExtent(-7.5, 0.5, 0, -0.5, 383)).toBe(398);
  });
});

describe('grid placement', () => {
  it('places explicit items, then flows the rest', () => {
    const { cells, rows } = placeGridItems([
      { colStart: 1, colSpan: 7, rowStart: 1 },
      { colStart: 8, colSpan: 5, rowStart: 1 },
      undefined,
      { colSpan: 12 },
    ], 12);
    expect(cells).toEqual([
      { row: 0, col: 0, rowSpan: 1, colSpan: 7 },
      { row: 0, col: 7, rowSpan: 1, colSpan: 5 },
      { row: 1, col: 0, rowSpan: 1, colSpan: 1 },
      { row: 2, col: 0, rowSpan: 1, colSpan: 12 },
    ]);
    expect(rows).toBe(3);
  });
  it('clamps spans and handles span-full', () => {
    const { cells } = placeGridItems([{ colStart: 3, colSpan: 9 }, { colSpan: -1 }], 4);
    expect(cells[0]).toEqual({ row: 0, col: 2, rowSpan: 1, colSpan: 2 });
    expect(cells[1]).toEqual({ row: 1, col: 0, rowSpan: 1, colSpan: 4 });
  });
});

describe('image placement', () => {
  it('sizes and positions like background-size / position', () => {
    // 200×100 box, 400×400 image at 132.73% × 100%, centred horizontally, top.
    const b = imageBox({ size: { w: { pct: 1.3273, px: 0 }, h: { pct: 1, px: 0 } }, position: { x: { pct: 0.5, px: 0 }, y: { pct: 0, px: 0 } } }, 200, 100, 400, 400);
    expect(b.w).toBeCloseTo(265.46);
    expect(b.h).toBe(100);
    expect(b.x).toBeCloseTo(-32.73);
    expect(b.y).toBe(0);
  });
  it('contains and keeps aspect for auto sides', () => {
    expect(imageBox({ size: 'contain' }, 200, 100, 400, 400)).toEqual({ x: 50, y: 0, w: 100, h: 100 });
    expect(imageBox({ size: { w: { pct: 0, px: 50 }, h: 'auto' } }, 200, 100, 400, 200)).toEqual({ x: 0, y: 0, w: 50, h: 25 });
  });
});

describe('gradients', () => {
  it('computes CSS radial sizes', () => {
    expect(radialRadii({ type: 'radial', angle: 0, stops: [], cx: 0.5, cy: 0.5, circle: true, extent: 'closest-side' }, 200, 100)).toEqual({ rx: 50, ry: 50 });
    const e = radialRadii({ type: 'radial', angle: 0, stops: [], cx: 0, cy: 0 }, 200, 100);
    expect(e.rx).toBeCloseTo(200 * Math.SQRT2);
    expect(e.ry).toBeCloseTo(100 * Math.SQRT2);
  });
  it('maps the radial centre to the gradient centre', () => {
    const p = gradientPaint({ type: 'radial', angle: 0, stops: [], cx: 0.25, cy: 0.5, circle: true, extent: { x: { pct: 0, px: 50 }, y: { pct: 0, px: 50 } } }, 200, 100);
    const [[a, , c], [, e, f]] = p.gradientTransform;
    expect(a * 0.25 + c).toBeCloseTo(0.5);
    expect(e * 0.5 + f).toBeCloseTo(0.5);
    expect(a * (0.25 + 50 / 200) + c).toBeCloseTo(1); // 50px to the right is the edge
  });
});

describe('image adjustments', () => {
  it('maps CSS amounts onto Figma\'s -1..1 range', () => {
    expect(imageAdjustments({ saturate: 0, brightness: 1.25, contrast: 3 })).toEqual({ saturation: -0.83, exposure: 0.08, contrast: 1 });
  });
});
