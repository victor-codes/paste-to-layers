import { describe, it, expect } from 'vitest';
import { tailwindToStyle as tw } from './tailwind';

describe('tailwindToStyle', () => {
  it('display and direction', () => {
    expect(tw('flex flex-col flex-wrap').style).toMatchObject({ display: 'flex', direction: 'column', wrap: true });
    expect(tw('inline-flex flex-row').style).toMatchObject({ display: 'flex', direction: 'row' });
    expect(tw('block').style.display).toBe('block');
    expect(tw('hidden').style.display).toBe('none');
  });
  it('gap respects direction', () => {
    expect(tw('gap-4').style.gap).toBe(16);
    expect(tw('flex-col gap-x-2 gap-y-6').style.gap).toBe(24);
    expect(tw('gap-x-2 gap-y-6').style.gap).toBe(8);
  });
  it('padding', () => {
    expect(tw('p-4').style.padding).toEqual({ top: 16, right: 16, bottom: 16, left: 16 });
    expect(tw('px-2 pt-0.5 pb-px').style.padding).toEqual({ top: 2, right: 8, bottom: 1, left: 8 });
    expect(tw('p-4 pl-0').style.padding?.left).toBe(0);
  });
  it('alignment', () => {
    expect(tw('justify-between items-center').style).toMatchObject({ justify: 'between', align: 'center' });
    expect(tw('self-stretch').style.heightSizing).toBe('FILL');
  });
  it('width and height', () => {
    expect(tw('w-10 h-full').style).toMatchObject({ width: 40, widthSizing: 'FIXED', heightSizing: 'FILL' });
    expect(tw('w-fit h-auto').style).toMatchObject({ widthSizing: 'HUG', heightSizing: 'HUG' });
    expect(tw('w-screen h-screen').style).toMatchObject({ width: 1440, height: 900 });
    const s = tw('w-10 w-full').style;
    expect(s.widthSizing).toBe('FILL');
    expect(s.width).toBeUndefined();
  });
  it('flex-1 and min/max width', () => {
    expect(tw('flex-1').style.widthSizing).toBe('FILL');
    expect(tw('grow').style.widthSizing).toBe('FILL');
    expect(tw('min-w-8 max-w-md').style).toMatchObject({ minWidth: 32, maxWidth: 448 });
    expect(tw('max-w-prose').style.maxWidth).toBe(640);
  });
  it('colors', () => {
    expect(tw('bg-white text-black').style).toMatchObject({
      background: { r: 1, g: 1, b: 1, a: 1 }, color: { r: 0, g: 0, b: 0, a: 1 },
    });
    expect(tw('bg-black/50').style.background).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    expect(tw('bg-[#ff0000]').style.background).toEqual({ r: 1, g: 0, b: 0, a: 1 });
  });
  it('border', () => {
    expect(tw('border').style.border?.width).toBe(1);
    expect(tw('border-2 border-black').style.border).toEqual({ width: 2, color: { r: 0, g: 0, b: 0, a: 1 } });
    expect(tw('border-0').style.border).toBeUndefined();
  });
  it('radius', () => {
    expect(tw('rounded').style.radius).toBe(4);
    expect(tw('rounded-full').style.radius).toBe(9999);
    expect(tw('rounded-none').style.radius).toBe(0);
    expect(tw('rounded-t-lg').style.radius).toEqual([8, 8, 0, 0]);
    expect(tw('rounded-tl-xl').style.radius).toEqual([12, 0, 0, 0]);
  });
  it('shadow', () => {
    expect(tw('shadow-md').style.shadows?.[0]).toMatchObject({ x: 0, y: 4, blur: 6, spread: -1 });
    expect(tw('shadow').style.shadows?.[0]).toMatchObject({ y: 1, blur: 3 });
    expect(tw('shadow-lg shadow-none').style.shadows).toBeUndefined();
  });
  it('opacity, overflow, position', () => {
    expect(tw('opacity-50').style.opacity).toBe(0.5);
    expect(tw('overflow-hidden').style.overflowHidden).toBe(true);
    expect(tw('overflow-visible').style.overflowHidden).toBe(false);
    expect(tw('absolute top-2 left-4').style).toMatchObject({ position: 'absolute', top: 8, left: 16 });
    expect(tw('relative -top-2').style).toMatchObject({ position: 'relative', top: -8 });
  });
  it('font size sets line height', () => {
    expect(tw('text-xl').style).toMatchObject({ fontSize: 20, lineHeight: 28 });
    expect(tw('text-sm').style).toMatchObject({ fontSize: 14, lineHeight: 20 });
  });
  it('font weight, family, italic', () => {
    expect(tw('font-bold font-mono italic').style).toMatchObject({
      fontWeight: 700, fontFamily: 'Roboto Mono', fontStyle: 'italic',
    });
    expect(tw('font-serif').style.fontFamily).toBe('Georgia');
    expect(tw('font-sans font-thin').style).toMatchObject({ fontFamily: 'Inter', fontWeight: 100 });
  });
  it('leading and tracking', () => {
    expect(tw('text-xl leading-tight').style.lineHeight).toBe(25);
    expect(tw('leading-tight text-xl').style.lineHeight).toBe(25);
    expect(tw('leading-6').style.lineHeight).toBe(24);
    expect(tw('text-xl tracking-wide').style.letterSpacing).toBeCloseTo(0.5);
    expect(tw('tracking-tight').style.letterSpacing).toBeCloseTo(-0.4);
  });
  it('text align, transform, decoration', () => {
    expect(tw('text-center uppercase underline').style).toMatchObject({
      textAlign: 'center', textTransform: 'upper', textDecoration: 'underline',
    });
    expect(tw('lowercase line-through text-right').style).toMatchObject({
      textTransform: 'lower', textDecoration: 'line-through', textAlign: 'right',
    });
  });
  it('arbitrary values', () => {
    expect(tw('p-[13px]').style.padding).toEqual({ top: 13, right: 13, bottom: 13, left: 13 });
    expect(tw('w-[2rem] text-[18px]').style).toMatchObject({ width: 32, fontSize: 18 });
    expect(tw('w-[100%]').style.widthSizing).toBe('FILL');
  });
  it('important and later overrides', () => {
    expect(tw('!p-2').style.padding?.top).toBe(8);
    expect(tw('p-2 p-4').style.padding?.top).toBe(16);
  });
  it('reports variants and unknown classes as unsupported', () => {
    const r = tw('hover:bg-red-500 md:flex sm:p-4 dark:text-white foo-bar flex');
    expect(r.unsupported).toEqual(['hover:bg-red-500', 'md:flex', 'sm:p-4', 'dark:text-white', 'foo-bar']);
    expect(r.style).toEqual({ display: 'flex' });
  });

  it('supports Tailwind v4 / design-tool exports', () => {
    const { style, unsupported } = tw(
      "[font-synthesis:none] wrap-anywhere overflow-clip antialiased shrink-0 border-solid origin-top-left " +
      "text-[34px]/10.5 tracking-[-0.02em] font-['Inter_Tight',system-ui,sans-serif] size-3.5 rounded-[50%] " +
      "[border-width:1.5px] border-[#2C2B27] -rotate-4 whitespace-pre",
    );
    expect(unsupported).toEqual([]);
    expect(style.fontSize).toBe(34);
    expect(style.lineHeight).toBe(42);
    expect(style.letterSpacing).toBeCloseTo(-0.68);
    expect(style.fontFamily).toBe('Inter Tight');
    expect(style.width).toBe(14);
    expect(style.height).toBe(14);
    expect(style.radius).toBe(9999);
    expect(style.border).toEqual({ width: 1.5, color: { r: 0x2c / 255, g: 0x2b / 255, b: 0x27 / 255, a: 1 } });
    expect(style.rotation).toBe(-4);
    expect(style.transformOrigin).toBe('top-left');
    expect(style.overflowHidden).toBe(true);
  });
  it('reads text-size/line-height without breaking color opacity', () => {
    expect(tw('text-xs/4').style).toMatchObject({ fontSize: 12, lineHeight: 16 });
    expect(tw('text-9xl/31').style).toMatchObject({ fontSize: 128, lineHeight: 124 });
    expect(tw('text-black/50').style.color).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
  });
  it('supports arbitrary box-shadow lists and w-max', () => {
    const { style, unsupported } = tw('[box-shadow:#00000080_0px_44px_90px,#FFD21F_0px_0px_0px_6px] w-max');
    expect(unsupported).toEqual([]);
    expect(style.shadows).toHaveLength(2);
    expect(style.shadows?.[1]).toMatchObject({ spread: 6 });
    expect(style.widthSizing).toBe('HUG');
  });
  it('supports gradient utilities', () => {
    const { style, unsupported } = tw('bg-gradient-to-r from-indigo-500 to-pink-500');
    expect(unsupported).toEqual([]);
    expect(style.gradient?.angle).toBe(90);
    expect(style.gradient?.stops).toHaveLength(2);
    expect(tw('bg-[linear-gradient(160deg,#fff_0%,#000_100%)]').style.gradient?.angle).toBe(160);
  });
});

describe('insets and translate', () => {
  it('reads fractions, arbitrary calc and negative translate', () => {
    const { style, unsupported } = tw('absolute left-1/2 top-[calc(50%-8px)] right-4 -translate-x-1/2 leading-[100%] text-[20px]');
    expect(unsupported).toEqual([]);
    expect(style.left).toBe(0);
    expect(style.top).toBe(-8);
    expect(style.right).toBe(16);
    expect(style.insetPct).toEqual({ left: 0.5, top: 0.5 });
    expect(style.translate).toEqual({ x: 0, y: 0, xPct: -0.5, yPct: 0 });
    expect(style.lineHeight).toBe(20);
  });
});

describe('Paper page sections', () => {
  it('reads inset shorthands, v4 container widths, basis and min-h', () => {
    const { style, unsupported } = tw('absolute inset-x-12 top-20 w-7xl basis-69.5 min-h-120 rounded-xs z-1 content-center');
    expect(unsupported).toEqual([]);
    expect([style.left, style.right, style.top]).toEqual([48, 48, 80]);
    expect(style.width).toBe(1280);
    expect(style.basis).toBe(278);
    expect(style.minHeight).toBe(480);
    expect(style.radius).toBe(2);
    expect(tw('-inset-2').style.bottom).toBe(-8);
  });

  it('reads grid templates and item lines', () => {
    const g = tw('grid grid-cols-[1fr_1fr_200px] grid-rows-[494.73px] gap-4 gap-y-2');
    expect(g.unsupported).toEqual([]);
    expect(g.style.grid).toEqual({ cols: [{ fr: 1 }, { fr: 1 }, { px: 200 }], rows: [{ px: 494.73 }], colGap: 16, rowGap: 8 });
    expect(tw('grid grid-cols-12').style.grid?.cols).toHaveLength(12);
    const item = tw('col-start-8 col-end-[span_5] row-start-1 row-end-auto self-center');
    expect(item.unsupported).toEqual([]);
    expect(item.style.gridItem).toEqual({ colStart: 8, colSpan: 5, rowStart: 1 });
    expect(item.style.alignSelf).toBe('center');
    expect(tw('col-start-2 col-end-4').style.gridItem).toEqual({ colStart: 2, colSpan: 2 });
  });

  it('reads gradient text and drop-shadow filters', () => {
    expect(tw('bg-clip-text').style.clipText).toBe(true);
    const f = tw('filter-[drop-shadow(#0000001A_0px_10px_7.5px)_drop-shadow(#0000001A_0px_4px_3px)]');
    expect(f.unsupported).toEqual([]);
    expect(f.style.shadows?.map((s) => s.y)).toEqual([10, 4]);
  });
});
