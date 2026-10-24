import { describe, it, expect } from 'vitest';
import { parseCssColor, tailwindColor, withAlpha } from './colors';

const hex = (c: { r: number; g: number; b: number }) =>
  '#' + [c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');

describe('parseCssColor', () => {
  it('hex', () => {
    expect(parseCssColor('#fff')).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    const c = parseCssColor('#11223380')!;
    expect(hex(c)).toBe('#112233');
    expect(c.a).toBeCloseTo(0.502, 2);
  });
  it('rgb', () => {
    expect(parseCssColor('rgb(0 0 0 / 50%)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    expect(parseCssColor('rgba(255, 0, 0, 0.25)')).toEqual({ r: 1, g: 0, b: 0, a: 0.25 });
  });
  it('hsl', () => {
    const c = parseCssColor('hsl(220 50% 50%)')!;
    expect(hex(c)).toBe('#406abf');
  });
  it('named / special', () => {
    expect(parseCssColor('transparent')!.a).toBe(0);
    expect(parseCssColor('white')).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(parseCssColor('currentColor')).toBeNull();
    expect(parseCssColor('nope')).toBeNull();
  });
});

describe('tailwindColor', () => {
  it('palette', () => {
    expect(hex(tailwindColor('blue-500')!)).toBe('#3b82f6');
    expect(hex(tailwindColor('slate-950')!)).toBe('#020617');
    expect(tailwindColor('blue-555')).toBeNull();
    expect(tailwindColor('white')!.a).toBe(1);
    expect(tailwindColor('transparent')!.a).toBe(0);
  });
});

describe('withAlpha', () => {
  it('sets alpha', () => {
    expect(withAlpha({ r: 1, g: 0, b: 0, a: 1 }, 0.3)).toEqual({ r: 1, g: 0, b: 0, a: 0.3 });
  });
});

describe('oklch / oklab', () => {
  it('matches known sRGB values', () => {
    const red = parseCssColor('oklch(62.8% 0.2577 29.23)')!; // #ff0000
    expect(red.r).toBeCloseTo(1, 2);
    expect(red.g).toBeCloseTo(0, 2);
    expect(red.b).toBeCloseTo(0, 2);
    const white = parseCssColor('oklab(1 0 0 / 50%)')!;
    expect([white.r, white.g, white.b, white.a].map((v) => +v.toFixed(3))).toEqual([1, 1, 1, 0.5]);
  });
});
