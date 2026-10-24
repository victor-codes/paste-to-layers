/**
 * Built-in checks: measure how Figma actually renders things the converter can only infer from the API.
 * The sandbox builds test layers and exports them; the UI draws the CSS version of each on a canvas and
 * picks the variant that matches best (see checksUi.ts). Type `/checks` in the plugin and press Create layers.
 */
import { conicTransform, CALIBRATION } from './render';
import { ADJUST_STEPS, ADJUST_TESTS, BLUR_CSS, BLUR_RATIOS, CONIC_SIZE, CONIC_TEST, IMAGE_SIZE } from './checkConfig';
import type { CheckImage, CheckResults } from './types';

const red: SolidPaint = { type: 'SOLID', color: { r: 0.9, g: 0.2, b: 0.1 } };

function box(w: number, h: number, parent: FrameNode): FrameNode {
  const f = figma.createFrame();
  f.resize(w, h);
  f.clipsContent = true;
  f.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  parent.appendChild(f);
  return f;
}

async function png(n: SceneNode): Promise<Uint8Array> {
  return n.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 1 } });
}

/** Does a skew survive being set on a layer, inside auto layout and outside it? */
function skewCheck(root: FrameNode): CheckResults['skew'] {
  const want: Transform = [[1, 0.5, 0], [0, 1, 0]];
  const read = (n: SceneNode) => (n as FrameNode).relativeTransform;
  // Figma normalises the axes (stretch goes into the size), so compare the y axis's direction, not its length.
  const sheared = (t: Transform) => Math.abs(t[0][1] / t[1][1] - 0.5) < 0.01 && Math.abs(t[1][0]) < 0.01;

  const free = figma.createFrame();
  free.resize(40, 40);
  root.appendChild(free);
  let freeKept = false;
  let freeErr = '';
  try { free.relativeTransform = want; freeKept = sheared(read(free)); } catch (e) { freeErr = String(e); }

  const al = figma.createFrame();
  al.layoutMode = 'VERTICAL';
  root.appendChild(al);
  const child = figma.createFrame();
  child.resize(40, 40);
  al.appendChild(child);
  let alKept = false;
  let alErr = '';
  try { child.relativeTransform = want; alKept = sheared(read(child)); } catch (e) { alErr = String(e); }
  return {
    free: { kept: freeKept, read: read(free).map((r) => r.map((n) => +n.toFixed(3))), error: freeErr },
    autoLayout: { kept: alKept, read: read(child).map((r) => r.map((n) => +n.toFixed(3))), error: alErr },
  };
}

export async function runChecks(testImage: Uint8Array): Promise<CheckResults> {
  const root = figma.createFrame();
  root.name = 'Paste to Layers checks';
  root.x = figma.viewport.bounds.x - 10000;
  root.y = figma.viewport.bounds.y - 10000;
  root.layoutMode = 'NONE';
  // A new frame is 100×100 and clips, which cut wider test layers down in their exports.
  root.clipsContent = false;
  root.resize(1000, 1000);
  const images: CheckImage[] = [];
  try {
    const skew = skewCheck(root);

    // Conic: every start offset / direction combination, scored against the canvas's CSS conic gradient.
    for (const offset of [-90, 0, 90, 180]) {
      for (const flip of [false, true]) {
        const f = box(CONIC_SIZE.w, CONIC_SIZE.h, root);
        f.fills = [{
          type: 'GRADIENT_ANGULAR',
          gradientTransform: conicTransform(CONIC_TEST, CONIC_SIZE.w, CONIC_SIZE.h, offset, flip),
          gradientStops: CONIC_TEST.stops.map((s) => ({ position: s.position, color: { ...s.color } })),
        }];
        images.push({ test: 'conic', variant: { offset, flip }, png: await png(f) });
      }
    }

    // Blur: a dark square blurred at several Figma radii for one CSS blur().
    for (const ratio of BLUR_RATIOS) {
      const f = box(80, 80, root);
      const r = figma.createRectangle();
      r.resize(32, 32);
      r.x = 24;
      r.y = 24;
      r.fills = [red];
      r.effects = [{ type: 'LAYER_BLUR', blurType: 'NORMAL', radius: BLUR_CSS * ratio, visible: true }];
      f.appendChild(r);
      images.push({ test: 'blur', variant: { ratio }, png: await png(f) });
    }

    // Image adjustments: the same test image at each Figma value, for each CSS filter amount.
    const hash = figma.createImage(testImage).hash;
    const kind = { brightness: 'exposure', contrast: 'contrast', saturate: 'saturation' } as const;
    for (const t of ADJUST_TESTS) {
      for (const v of ADJUST_STEPS) {
        const f = box(IMAGE_SIZE, IMAGE_SIZE, root);
        f.fills = [{ type: 'IMAGE', imageHash: hash, scaleMode: 'FILL', filters: { [kind[t.fn]]: v } }];
        images.push({ test: t.fn, variant: { amount: t.amount, value: v }, png: await png(f) });
      }
    }
    return { skew, images, calibration: { ...CALIBRATION } };
  } finally {
    root.remove();
  }
}
