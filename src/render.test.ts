import { describe, expect, it } from 'vitest';
import { closestStyle, fitExtent, parseStyleName } from './render';

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
