/**
 * UI half of the built-in checks: draws the CSS version of each test on a canvas (the plugin UI is a
 * browser, so this is the browser's own rendering), scores Figma's exports against it, and writes a report.
 */
import { ADJUST_TESTS, BLUR_CSS, CONIC_SIZE, CONIC_TEST, IMAGE_SIZE } from './checkConfig';
import type { CheckImage, CheckResults } from './types';

export const CHECKS_COMMAND = '/checks';

function canvas(w: number, h: number): CanvasRenderingContext2D {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c.getContext('2d', { willReadFrequently: true })!;
}

/** A colourful 64×64 test image: hues across, light to dark down. */
export async function testImage(): Promise<Uint8Array> {
  const ctx = canvas(IMAGE_SIZE, IMAGE_SIZE);
  for (let x = 0; x < IMAGE_SIZE; x++) {
    for (let y = 0; y < IMAGE_SIZE; y++) {
      ctx.fillStyle = `hsl(${(x / IMAGE_SIZE) * 360} 80% ${85 - (y / IMAGE_SIZE) * 70}%)`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  const blob = await new Promise<Blob>((res) => ctx.canvas.toBlob((b) => res(b!), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

const exportSizes = new Set<string>();

/** Decodes an export at the reference's size (noting any export that came out a different size). */
async function pixels(png: Uint8Array, w: number, h: number): Promise<ImageData> {
  const bmp = await createImageBitmap(new Blob([png as BlobPart], { type: 'image/png' }));
  if (bmp.width !== w || bmp.height !== h) exportSizes.add(`${bmp.width}×${bmp.height} (expected ${w}×${h})`);
  const ctx = canvas(w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

/** Mean absolute RGB difference, 0 (identical) to 255. */
function diff(a: ImageData, b: ImageData): number {
  let sum = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    sum += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
  }
  return sum / ((a.data.length / 4) * 3);
}

const css = (c: { r: number; g: number; b: number }) => `rgb(${c.r * 255} ${c.g * 255} ${c.b * 255})`;

function conicReference(): ImageData {
  const { w, h } = CONIC_SIZE;
  const ctx = canvas(w, h);
  // Canvas conic angles start along +x; CSS `from 0deg` points up.
  const g = ctx.createConicGradient(((CONIC_TEST.angle - 90) * Math.PI) / 180, CONIC_TEST.cx! * w, CONIC_TEST.cy! * h);
  for (const s of CONIC_TEST.stops) g.addColorStop(s.position, css(s.color));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

function blurReference(): ImageData {
  const ctx = canvas(80, 80);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 80, 80);
  ctx.filter = `blur(${BLUR_CSS}px)`;
  ctx.fillStyle = css({ r: 0.9, g: 0.2, b: 0.1 });
  ctx.fillRect(24, 24, 32, 32);
  return ctx.getImageData(0, 0, 80, 80);
}

async function adjustReference(image: Uint8Array, filter: string): Promise<ImageData> {
  const bmp = await createImageBitmap(new Blob([image as BlobPart], { type: 'image/png' }));
  const ctx = canvas(IMAGE_SIZE, IMAGE_SIZE);
  ctx.filter = filter;
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, IMAGE_SIZE, IMAGE_SIZE);
}

async function score(images: CheckImage[], ref: ImageData) {
  const out: { variant: CheckImage['variant']; diff: number }[] = [];
  for (const im of images) out.push({ variant: im.variant, diff: diff(await pixels(im.png, ref.width, ref.height), ref) });
  return out.sort((a, b) => a.diff - b.diff);
}

const fmt = (n: number) => n.toFixed(2);
const label = (v: CheckImage['variant']) => Object.entries(v).map(([k, x]) => `${k} ${x}`).join(', ');

/** Plain-text report to paste back to whoever is tuning the converter. */
export async function checksReport(r: CheckResults, image: Uint8Array): Promise<string> {
  exportSizes.clear();
  const lines = ['Paste to Layers checks', `calibration in this build: ${JSON.stringify(r.calibration)}`, ''];
  for (const [k, v] of Object.entries(r.skew)) {
    lines.push(`skew (${k === 'free' ? 'free layer' : 'inside auto layout'}): ${v.kept ? 'kept' : 'DROPPED'}; read back ${JSON.stringify(v.read)}${v.error ? '; error ' + v.error : ''}`);
  }
  const of = (test: string) => r.images.filter((i) => i.test === test);

  const conic = await score(of('conic'), conicReference());
  lines.push('', `conic: best ${label(conic[0].variant)} (diff ${fmt(conic[0].diff)}); others ${conic.slice(1, 4).map((c) => `${label(c.variant)} ${fmt(c.diff)}`).join(' | ')}`);

  const blur = await score(of('blur'), blurReference());
  lines.push(`blur: best ratio ${blur[0].variant.ratio} (diff ${fmt(blur[0].diff)}); all ${blur.map((b) => `${b.variant.ratio}:${fmt(b.diff)}`).join(' ')}`);

  lines.push('');
  for (const t of ADJUST_TESTS) {
    const imgs = of(t.fn).filter((i) => i.variant.amount === t.amount);
    const s = await score(imgs, await adjustReference(image, `${t.fn}(${t.amount})`));
    const unchanged = s.find((x) => x.variant.value === 0);
    lines.push(`${t.fn}(${t.amount}): best Figma value ${s[0].variant.value} (diff ${fmt(s[0].diff)}; untouched image ${fmt(unchanged?.diff ?? NaN)})`);
  }
  if (exportSizes.size) lines.push('', `export sizes off: ${[...exportSizes].join(', ')}`);
  return lines.join('\n');
}
