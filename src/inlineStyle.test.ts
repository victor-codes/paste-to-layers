import { describe, it, expect, vi } from 'vitest';

vi.mock('./colors', () => ({
  parseCssColor: (s: string) => {
    let m = /^#([0-9a-f]{6})$/i.exec(s);
    if (m) {
      const n = parseInt(m[1], 16);
      return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a: 1 };
    }
    m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(s) as RegExpExecArray | null;
    if (m) return { r: +m[1] / 255, g: +m[2] / 255, b: +m[3] / 255, a: m[4] === undefined ? 1 : +m[4] };
    return null;
  },
}));

import { inlineToStyle, parseGradient } from './inlineStyle';

describe('inlineToStyle', () => {
  it('handles padding shorthands', () => {
    expect(inlineToStyle({ padding: '8px 16px' }).style.padding).toEqual({ top: 8, right: 16, bottom: 8, left: 16 });
    expect(inlineToStyle({ padding: '1px 2px 3px 4px' }).style.padding).toEqual({ top: 1, right: 2, bottom: 3, left: 4 });
    expect(inlineToStyle({ padding: 12 }).style.padding).toEqual({ top: 12, right: 12, bottom: 12, left: 12 });
  });
  it('handles border, radius, shadow, background', () => {
    const { style, unsupported } = inlineToStyle({
      border: '1px solid #ff0000',
      borderRadius: '4px 8px',
      boxShadow: '0 2px 4px 1px rgba(0, 0, 0, 0.5), 0 0 1px #000000',
      backgroundColor: '#000000',
    });
    expect(unsupported).toEqual([]);
    expect(style.border).toEqual({ width: 1, color: { r: 1, g: 0, b: 0, a: 1 } });
    expect(style.radius).toEqual([4, 8, 4, 8]);
    expect(style.shadows).toEqual([
      { x: 0, y: 2, blur: 4, spread: 1, color: { r: 0, g: 0, b: 0, a: 0.5 } },
      { x: 0, y: 0, blur: 1, spread: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
    ]);
    expect(style.background).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });
  it('reports unparseable gradients, keeps percentages for the renderer', () => {
    const r = inlineToStyle({ background: 'linear-gradient(red, blue)', width: '50%', height: 'calc(100% - 20px)' });
    expect(r.unsupported).toEqual(['background']);
    expect(r.style.widthPct).toEqual({ pct: 0.5, px: 0 });
    expect(r.style.heightPct).toEqual({ pct: 1, px: -20 });
    expect(inlineToStyle({ width: '100%' }).style.widthSizing).toBe('FILL');
  });
  it('converts rem and em', () => {
    expect(inlineToStyle({ gap: '1.5rem' }).style.gap).toBe(24);
    const { style } = inlineToStyle({ fontSize: '20px', padding: '2em' });
    expect(style.padding?.top).toBe(40);
    expect(inlineToStyle({ padding: '1em' }).style.padding?.top).toBe(16);
  });
  it('maps flex props and flex: 1', () => {
    const { style } = inlineToStyle({ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', alignItems: 'center', flex: 1 });
    expect(style).toMatchObject({ display: 'flex', direction: 'column', justify: 'between', align: 'center', widthSizing: 'FILL' });
  });

  it('handles the styles design tools export', () => {
    const { style, unsupported } = inlineToStyle({
      boxSizing: 'border-box', WebkitFontSmoothing: 'antialiased', flexShrink: '0', overflow: 'clip',
      paddingBlock: '34px', paddingInline: '36px 12px', borderWidth: '1.5px', borderStyle: 'solid',
      borderColor: '#2c2b27', rotate: '-4deg', transformOrigin: '0% 0%', width: 'max-content',
      display: 'inline-block',
    });
    expect(unsupported).toEqual([]);
    expect(style.padding).toEqual({ top: 34, right: 12, bottom: 34, left: 36 });
    expect(style.border?.width).toBe(1.5);
    expect(style.rotation).toBe(-4);
    expect(style.transformOrigin).toBe('top-left');
    expect(style.widthSizing).toBe('HUG');
    expect(style.overflowHidden).toBe(true);
    expect(style.display).toBe('block');
  });
  it('reads overflow: visible as not clipping', () => {
    expect(inlineToStyle({ overflow: 'visible' }).style.overflowHidden).toBe(false);
  });
  it('parses linear gradients', () => {
    const { style, unsupported } = inlineToStyle({
      backgroundImage: 'linear-gradient(in oklab 160deg, #c8d3c0 0%, #8fa68a 100%)',
    });
    expect(unsupported).toEqual([]);
    expect(style.gradient?.angle).toBe(160);
    expect(style.gradient?.stops.map((s) => s.position)).toEqual([0, 1]);
    expect(inlineToStyle({ background: 'linear-gradient(to top right, #000000, #ffffff, #000000)' }).style.gradient)
      .toMatchObject({ angle: 45, stops: [{ position: 0 }, { position: 0.5 }, { position: 1 }] });
  });
  it('treats 50% radius as a circle', () => {
    expect(inlineToStyle({ borderRadius: '50%' }).style.radius).toBe(9999);
  });
});

describe('positioning and fonts from Paper exports', () => {
  it('reads calc/percent insets, translate and % line-height', () => {
    const { style, unsupported } = inlineToStyle({
      position: 'absolute', left: 'calc(50% - 7.5px)', top: '399px', translate: '-50%', fontSize: '60px', lineHeight: '100%',
    });
    expect(unsupported).toEqual([]);
    expect(style.left).toBe(-7.5);
    expect(style.insetPct).toEqual({ left: 0.5 });
    expect(style.top).toBe(399);
    expect(style.translate).toEqual({ x: 0, y: 0, xPct: -0.5, yPct: 0 });
    expect(style.lineHeight).toBe(60);
  });

  it('reads transform translate with rotate', () => {
    const { style, unsupported } = inlineToStyle({ transform: 'translate(-50%, -50%) rotate(45deg)' });
    expect(unsupported).toEqual([]);
    expect(style.translate).toEqual({ x: 0, y: 0, xPct: -0.5, yPct: -0.5 });
    expect(style.rotation).toBe(45);
  });

  it('keeps the font stack minus generic families', () => {
    const { style } = inlineToStyle({ fontFamily: '"CooperBT-Medium", "Cooper BT", system-ui, sans-serif' });
    expect(style.fontFamily).toBe('CooperBT-Medium');
    expect(style.fontFallbacks).toEqual(['Cooper BT']);
  });

  it('reads background-image urls next to gradients', () => {
    const { style, unsupported } = inlineToStyle({ backgroundImage: 'linear-gradient(0deg, #000000 0%, #ffffff 100%), url("https://x.test/a.jpg")' });
    expect(unsupported).toEqual([]);
    expect(style.imageUrl).toBe('https://x.test/a.jpg');
    expect(style.gradient?.stops).toHaveLength(2);
  });

  it('reads grid templates and lines', () => {
    const { style, unsupported } = inlineToStyle({ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr)) 120px', columnGap: '16px', gridColumn: '1 / span 2' });
    expect(unsupported).toEqual([]);
    expect(style.grid?.cols).toEqual([{ fr: 1 }, { fr: 1 }, { fr: 1 }, { px: 120 }]);
    expect(style.grid?.colGap).toBe(16);
    expect(style.gridItem).toEqual({ colStart: 1, colSpan: 2 });
  });

  it('keeps the line type of a text-decoration shorthand', () => {
    expect(inlineToStyle({ textDecoration: 'underline 1px oklch(55% 0.2 30)' }).style.textDecoration).toBe('underline');
  });

  it('reads per-side border shorthands and colors', () => {
    const { style, unsupported } = inlineToStyle({ borderBottom: '1px solid #ff0000', borderTopWidth: '2px', borderTopColor: '#ff0000', borderLeftStyle: 'solid' });
    expect(unsupported).toEqual([]);
    expect(style.border).toEqual({ width: 2, color: { r: 1, g: 0, b: 0, a: 1 }, sides: [2, 0, 1, 0] });
    const multi = inlineToStyle({ borderWidth: '1px', borderColor: '#ff0000 #00ff00' });
    expect(multi.style.border?.color).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect(multi.unsupported).toEqual(['borderColor']);
  });

  it('reads blur filters', () => {
    const { style, unsupported } = inlineToStyle({ filter: 'blur(10px)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' });
    expect(unsupported).toEqual([]);
    expect([style.blur, style.backdropBlur]).toEqual([10, 8]);
  });

  it('reads margins, shadows, clamping and image placement', () => {
    const { style, unsupported } = inlineToStyle({
      margin: '0 auto', marginTop: '12px', boxShadow: 'inset 0 1px 2px #000000', textShadow: '0 1px 2px #000000',
      mixBlendMode: 'screen', transform: 'scale(1.2)', WebkitLineClamp: 3, display: '-webkit-box', WebkitBoxOrient: 'vertical',
      objectFit: 'cover', objectPosition: 'left top', aspectRatio: '1 / 1', maxHeight: '200px', borderStyle: 'dashed', border: '2px solid #000000',
    });
    expect(unsupported).toEqual([]);
    expect(style.margin).toEqual({ top: 12, right: 0, bottom: 0, left: 0, autoX: true });
    expect(style.shadows?.[0].inset).toBe(true);
    expect(style.textShadows?.[0].blur).toBe(2);
    expect(style.blendMode).toBe('SCREEN');
    expect(style.scale).toBe(1.2);
    expect(style.maxLines).toBe(3);
    expect(style.imageFit).toEqual({ size: 'cover', position: { x: { pct: 0, px: 0 }, y: { pct: 0, px: 0 } } });
    expect(style.aspectRatio).toBe(1);
    expect(style.maxHeight).toBe(200);
    expect(style.border?.style).toBe('dashed');
  });

  it('parses radial and conic gradients', () => {
    expect(parseGradient('radial-gradient(circle 40px at 10% 20%, #ff0000, #0000ff)')).toMatchObject(
      { type: 'radial', circle: true, cx: 0.1, cy: 0.2, extent: { x: { pct: 0, px: 40 }, y: { pct: 0, px: 40 } } });
    const c = parseGradient('conic-gradient(from 45deg, #ff0000, #0000ff 180deg, #ff0000)');
    expect(c).toMatchObject({ type: 'conic', angle: 45 });
    expect(c?.stops.map((s) => s.position)).toEqual([0, 0.5, 1]);
  });

  it('keeps every background layer, top first', () => {
    const { style } = inlineToStyle({ backgroundImage: 'linear-gradient(#000000, #ffffff), url(a.png), radial-gradient(#ff0000, #0000ff)', backgroundRepeat: 'repeat' });
    expect(style.layers?.map((l) => ('url' in l ? 'url' : l.gradient.type ?? 'linear'))).toEqual(['linear', 'url', 'radial']);
    expect(style.imageFit?.repeat).toBe(true);
  });

  it('turns transforms into rotation/scale or a matrix', () => {
    expect(inlineToStyle({ transform: 'rotate(30deg) scale(2)' }).style).toMatchObject({ rotation: 30, scale: 2 });
    const sk = inlineToStyle({ transform: 'skewX(45deg)' });
    expect(sk.unsupported).toEqual([]);
    expect(sk.style.matrix?.map((n) => +n.toFixed(6))).toEqual([1, 0, 1, 1]);
    expect(inlineToStyle({ transform: 'rotateX(60deg)' }).style.matrix?.map((n) => +n.toFixed(6))).toEqual([1, 0, 0, 0.5]);
    const m = inlineToStyle({ transform: 'matrix(1, 0, 0, 2, 10, 20)' }).style;
    expect(m.matrix).toEqual([1, 0, 0, 2]);
    expect(m.translate).toMatchObject({ x: 10, y: 20 });
    expect(inlineToStyle({ transform: 'perspective(500px) rotateY(20deg)' }).unsupported).toEqual(['transform']);
  });

  it('maps image filters and opacity()', () => {
    const { style, unsupported } = inlineToStyle({ filter: 'grayscale(100%) brightness(1.2) opacity(0.5)' });
    expect(unsupported).toEqual([]);
    expect(style.imageFilters).toEqual({ saturate: 0, brightness: 1.2 });
    expect(style.opacity).toBe(0.5);
    expect(inlineToStyle({ filter: 'hue-rotate(90deg)' }).unsupported).toEqual(['filter']);
  });
});
