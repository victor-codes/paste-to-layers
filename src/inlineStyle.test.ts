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

import { inlineToStyle } from './inlineStyle';

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
  it('reports gradients and percentages as unsupported', () => {
    const r = inlineToStyle({ background: 'linear-gradient(red, blue)', width: '50%' });
    expect(r.unsupported).toEqual(['background', 'width']);
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
