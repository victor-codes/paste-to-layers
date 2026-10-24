/** Test setups shared by the sandbox (checks.ts) and the UI (checksUi.ts). */
import type { Gradient } from './types';

export const CONIC_TEST: Gradient = {
  type: 'conic', angle: 30, cx: 0.3, cy: 0.6,
  stops: [
    { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
    { position: 0.5, color: { r: 1, g: 0.9, b: 0, a: 1 } },
    { position: 1, color: { r: 0, g: 0.2, b: 1, a: 1 } },
  ],
};
export const CONIC_SIZE = { w: 160, h: 100 };
export const BLUR_CSS = 8;
export const BLUR_RATIOS = [2, 2.2, 2.4, 2.5, 2.6, 2.8, 3];
/** CSS filter amounts to match, and the Figma adjustment values tried for each. */
export const ADJUST_TESTS: { fn: 'brightness' | 'contrast' | 'saturate'; amount: number }[] = [
  { fn: 'brightness', amount: 0.7 }, { fn: 'brightness', amount: 1.3 },
  { fn: 'contrast', amount: 0.7 }, { fn: 'contrast', amount: 1.3 },
  { fn: 'saturate', amount: 0.4 }, { fn: 'saturate', amount: 1.6 },
];
export const ADJUST_STEPS = Array.from({ length: 21 }, (_, i) => Math.round((i / 10 - 1) * 10) / 10);
export const IMAGE_SIZE = 64;
