import { describe, expect, it } from 'vitest';
import { closestStyle, fitExtent, parseStyleName, placeGridItems } from './render';

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
