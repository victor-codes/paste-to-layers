import type { BgLayer, BlendMode, BorderStyle, Gradient, GridTrack, ImageAdjust, ImageFit, NormalizedStyle, Pct, RGBA, Shadow, Sizing } from './types';
import { parseCssColor } from './colors';

type Len = { px: number } | { fill: true } | null;

function splitTop(s: string, sep: RegExp = /\s+/): string[] {
  // split on whitespace outside parentheses
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s.trim()) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth === 0 && sep.test(ch)) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** Splits CSS text on `sep` outside parentheses and quotes (so `url(data:…;base64,…)` stays whole). */
export function splitCss(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let cur = '';
  for (const ch of s) {
    if (quote) { if (ch === quote) quote = ''; }
    else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === sep && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

export interface Declaration { prop: string; value: string; important: boolean }

/** `color: red; margin: 0 !important` → declarations in order (property names lowercased, as written). */
export function parseDeclarations(css: string): Declaration[] {
  const out: Declaration[] = [];
  for (const part of splitCss(css.replace(/\/\*[\s\S]*?\*\//g, ''), ';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const prop = part.slice(0, i).trim();
    let value = part.slice(i + 1).trim();
    if (!prop || !value) continue;
    const important = /!\s*important\s*$/i.test(value);
    if (important) value = value.replace(/!\s*important\s*$/i, '').trim();
    out.push({ prop: prop.startsWith('--') ? prop : prop.toLowerCase(), value, important });
  }
  return out;
}

/** `background-color` → `backgroundColor`, `-webkit-line-clamp` → `WebkitLineClamp` (React's style keys). */
export function camelProp(p: string): string {
  return p.replace(/^-ms-/, 'ms-').replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** Properties with no visual effect in Figma (rendering hints, box model, wrapping, interaction). */
const IGNORED = new Set([
  'boxSizing', 'fontSynthesis', 'WebkitFontSmoothing', 'MozOsxFontSmoothing', 'textRendering',
  'fontFeatureSettings', 'fontOpticalSizing', 'overflowWrap', 'wordBreak', 'wordWrap', 'hyphens',
  'flexShrink', 'cursor', 'userSelect', 'pointerEvents', 'WebkitTapHighlightColor',
  'transition', 'transitionProperty', 'transitionDuration', 'transitionTimingFunction', 'willChange',
  'outline', 'listStyle', 'textSizeAdjust', 'WebkitTextSizeAdjust', 'borderTopStyle', 'borderRightStyle',
  'borderBottomStyle', 'borderLeftStyle', 'backgroundOrigin', 'contain', 'isolation',
  'zIndex', 'fontVariationSettings', 'alignContent', 'textUnderlinePosition', 'textUnderlineOffset',
  'WebkitBoxOrient', 'overflowX', 'overflowY',
]);

const ANGLE_UNITS: Record<string, number> = { deg: 1, grad: 0.9, rad: 180 / Math.PI, turn: 360 };
const SIDE_ANGLES: Record<string, number> = {
  top: 0, 'top right': 45, right: 90, 'bottom right': 135, bottom: 180, 'bottom left': 225, left: 270, 'top left': 315,
};

function parseAngle(s: string): number | null {
  const m = /^(-?\d*\.?\d+)(deg|grad|rad|turn)$/.exec(s.trim());
  return m ? parseFloat(m[1]) * ANGLE_UNITS[m[2]] : null;
}

const POS_KEYWORDS: Record<string, number> = { left: 0, top: 0, center: 0.5, right: 1, bottom: 1 };

/** One background-position / gradient `at` component: keyword, %, or px. */
function parsePos(v: string): Pct | null {
  if (v in POS_KEYWORDS) return { pct: POS_KEYWORDS[v], px: 0 };
  let m: RegExpExecArray | null;
  if ((m = /^(-?\d*\.?\d+)%$/.exec(v))) return { pct: parseFloat(m[1]) / 100, px: 0 };
  if ((m = /^(-?\d*\.?\d+)(px)?$/.exec(v))) return { pct: 0, px: parseFloat(m[1]) };
  return null;
}

/** `left top`, `50% 0%`, `bottom`, `right 20%` → x and y. */
export function parsePosition(v: string): { x: Pct; y: Pct } | null {
  const parts = v.trim().split(/\s+/);
  if (parts.length === 1) {
    const p = parts[0];
    if (p === 'top' || p === 'bottom') return { x: { pct: 0.5, px: 0 }, y: parsePos(p)! };
    const x = parsePos(p);
    return x && { x, y: { pct: 0.5, px: 0 } };
  }
  if (parts.length !== 2) return null;
  let [a, b] = parts;
  if (a === 'top' || a === 'bottom' || b === 'left' || b === 'right') [a, b] = [b, a];
  const x = parsePos(a);
  const y = parsePos(b);
  return x && y ? { x, y } : null;
}

const BLEND_MODES: Record<string, BlendMode> = {
  multiply: 'MULTIPLY', screen: 'SCREEN', overlay: 'OVERLAY', darken: 'DARKEN', lighten: 'LIGHTEN',
  'color-dodge': 'COLOR_DODGE', 'color-burn': 'COLOR_BURN', 'hard-light': 'HARD_LIGHT', 'soft-light': 'SOFT_LIGHT',
  difference: 'DIFFERENCE', exclusion: 'EXCLUSION', hue: 'HUE', saturation: 'SATURATION', color: 'COLOR', luminosity: 'LUMINOSITY',
};
/** `mix-blend-mode` value → Figma blend mode; null for `normal`/unknown. */
export function parseBlendMode(v: string): BlendMode | null {
  return BLEND_MODES[v.trim()] ?? null;
}

export type Mat = [number, number, number, number]; // CSS matrix(a, b, c, d): x' = a·x + c·y, y' = b·x + d·y
export const IDENTITY: Mat = [1, 0, 0, 1];
export const mulMat = (p: Mat, q: Mat): Mat =>
  [p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1], p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3]];
const rad = (deg: number) => (deg * Math.PI) / 180;
export const rotateMat = (deg: number): Mat => [Math.cos(rad(deg)), Math.sin(rad(deg)), -Math.sin(rad(deg)), Math.cos(rad(deg))];
export const skewMat = (xDeg: number, yDeg: number): Mat => [1, Math.tan(rad(yDeg)), Math.tan(rad(xDeg)), 1];
export const scaleMat = (x: number, y = x): Mat => [x, 0, 0, y];

/**
 * Store a transform's linear part: rotation + uniform scale stay as `rotation`/`scale` (Figma's own fields);
 * anything with skew or uneven scale becomes a matrix.
 */
export function setMatrix(style: NormalizedStyle, m: Mat): void {
  const eq = (x: number, y: number) => Math.abs(x - y) < 1e-6;
  delete style.rotation; delete style.scale; delete style.matrix;
  if (eq(m[2], -m[1]) && eq(m[3], m[0])) {
    const round = (n: number) => Math.round(n * 1e6) / 1e6;
    const k = round(Math.hypot(m[0], m[1]));
    const deg = round((Math.atan2(m[1], m[0]) * 180) / Math.PI);
    if (!eq(deg, 0)) style.rotation = deg;
    if (!eq(k, 1)) style.scale = k;
    return;
  }
  style.matrix = m;
}

/** Number or percentage amount for filter functions (`0.5`, `50%`). */
function amount(v: string | undefined, def = 1): number | null {
  if (v === undefined || v.trim() === '') return def;
  const s = v.trim();
  const n = s.endsWith('%') ? parseFloat(s) / 100 : Number(s);
  return Number.isFinite(n) ? n : null;
}

/** brightness/contrast/saturate/grayscale amounts (CSS units) onto an ImageAdjust. */
export function addImageFilter(adj: ImageAdjust, fn: string, arg: string | undefined): boolean {
  const n = amount(arg);
  if (n === null) return false;
  if (fn === 'brightness') adj.brightness = (adj.brightness ?? 1) * n;
  else if (fn === 'contrast') adj.contrast = (adj.contrast ?? 1) * n;
  else if (fn === 'saturate') adj.saturate = (adj.saturate ?? 1) * n;
  else if (fn === 'grayscale') adj.saturate = (adj.saturate ?? 1) * (1 - Math.min(1, n));
  else return false;
  return true;
}

/** `16 / 9`, `1.5`, `1` → width / height. */
export function parseAspectRatio(v: string): number | null {
  const m = /^(\d*\.?\d+)\s*(?:\/\s*(\d*\.?\d+))?$/.exec(v.trim());
  if (!m) return null;
  const r = parseFloat(m[1]) / (m[2] ? parseFloat(m[2]) : 1);
  return Number.isFinite(r) && r > 0 ? r : null;
}

/** Comma-separated CSS shadows (box-shadow, or text-shadow without spread). */
export function parseShadows(v: string, text = false): { shadows: Shadow[]; bad: boolean } {
  const shadows: Shadow[] = [];
  let bad = false;
  for (const layer of splitTop(v, /,/)) {
    const parts = splitTop(layer);
    const inset = parts.includes('inset');
    if (inset && text) { bad = true; continue; }
    const nums: number[] = [];
    let col: RGBA | undefined;
    for (const p of parts) {
      if (p === 'inset') continue;
      const m = /^(-?\d*\.?\d+)(px|rem)?$/.exec(p);
      if (m) { nums.push(parseFloat(m[1]) * (m[2] === 'rem' ? 16 : 1)); continue; }
      const c = parseCssColor(p);
      if (c) col = c; else bad = true;
    }
    if (nums.length < 2 || nums.length > (text ? 3 : 4)) { bad = true; continue; }
    const sh: Shadow = { x: nums[0], y: nums[1], blur: nums[2] ?? 0, spread: nums[3] ?? 0, color: col ?? { r: 0, g: 0, b: 0, a: 1 } };
    if (inset) sh.inset = true;
    shadows.push(sh);
  }
  return { shadows, bad };
}

/** background-size / object-fit value → image size. */
export function parseImageSize(v: string): ImageFit['size'] | null {
  const sv = v.trim();
  if (sv === 'cover' || sv === 'contain') return sv;
  const parts = sv.split(/\s+/);
  if (parts.length > 2) return null;
  const one = (p: string): Pct | 'auto' | null => {
    if (p === 'auto') return 'auto';
    const m = /^(\d*\.?\d+)(%|px)?$/.exec(p);
    if (!m) return null;
    return m[2] === '%' ? { pct: parseFloat(m[1]) / 100, px: 0 } : { pct: 0, px: parseFloat(m[1]) };
  };
  const w = one(parts[0]);
  const h = one(parts[1] ?? 'auto');
  return w && h ? { w, h } : null;
}

/** CSS linear-, radial- or conic-gradient (first layer only). */
export function parseGradient(s: string): Gradient | null {
  const m = /^(?:repeating-)?(linear|radial|conic)-gradient\((.*)\)$/i.exec(s.trim());
  if (!m) return null;
  const type = m[1].toLowerCase() as 'linear' | 'radial' | 'conic';
  const args = splitTop(m[2], /,/).map((a) => a.trim());
  const g: Gradient = { type, angle: type === 'linear' ? 180 : 0, stops: [] };
  // Colour interpolation hints (`in oklab`) don't change the stops enough to matter.
  const head = args[0]?.replace(/\bin\s+[a-z-]+(\s+(shorter|longer|increasing|decreasing)\s+hue)?/gi, '').trim() ?? '';
  const isStop = (a: string) => parseCssColor(splitTop(a)[0] ?? '') !== null;
  if (type === 'linear') {
    if (/^to\s/.test(head)) {
      const side = head.slice(3).trim().split(/\s+/).sort((a, b) => (a === 'top' || a === 'bottom' ? -1 : b === 'top' || b === 'bottom' ? 1 : 0)).join(' ');
      if (!(side in SIDE_ANGLES)) return null;
      g.angle = SIDE_ANGLES[side];
      args.shift();
    } else if (parseAngle(head) !== null) {
      g.angle = parseAngle(head)!;
      args.shift();
    } else if (head === '') {
      args.shift();
    }
  } else if (head === '' || !isStop(head)) {
    args.shift();
    const [shape, at] = head.split(/\s*\bat\b\s*/);
    const pos = at ? parsePosition(at) : { x: { pct: 0.5, px: 0 }, y: { pct: 0.5, px: 0 } };
    if (!pos || pos.x.px || pos.y.px) return null;
    g.cx = pos.x.pct;
    g.cy = pos.y.pct;
    const words = (shape ?? '').split(/\s+/).filter(Boolean);
    if (type === 'conic') {
      if (words[0] === 'from') {
        const a = parseAngle(words[1] ?? '');
        if (a === null) return null;
        g.angle = a;
      } else if (words.length) return null;
    } else {
      const lens: Pct[] = [];
      for (const w of words) {
        if (w === 'circle') g.circle = true;
        else if (w === 'ellipse') g.circle = false;
        else if (/^(closest|farthest)-(side|corner)$/.test(w)) g.extent = w as Gradient['extent'];
        else {
          const l = parsePos(w);
          if (!l || w in POS_KEYWORDS) return null;
          lens.push(l);
        }
      }
      if (lens.length) {
        g.extent = { x: lens[0], y: lens[1] ?? lens[0] };
        if (lens.length === 1) g.circle = true;
      }
    }
  }
  const raw: { color: RGBA; position?: number }[] = [];
  for (const a of args) {
    const parts = splitTop(a);
    const color = parseCssColor(parts[0] ?? '');
    if (!color) return null;
    const positions = parts.slice(1).map((p) => {
      if (/^-?\d*\.?\d+%$/.test(p)) return parseFloat(p) / 100;
      const deg = type === 'conic' ? parseAngle(p) : null;
      return deg !== null ? deg / 360 : NaN;
    });
    if (positions.some((p) => Number.isNaN(p))) return null;
    if (positions.length === 0) raw.push({ color });
    for (const position of positions) raw.push({ color, position });
  }
  if (raw.length < 2) return null;
  // Fill in missing positions: first 0, last 1, others evenly between known neighbours.
  if (raw[0].position === undefined) raw[0].position = 0;
  if (raw[raw.length - 1].position === undefined) raw[raw.length - 1].position = 1;
  for (let i = 1; i < raw.length; i++) {
    if (raw[i].position !== undefined) continue;
    let j = i;
    while (raw[j].position === undefined) j++;
    const from = raw[i - 1].position!;
    const to = raw[j].position!;
    for (let k = i; k < j; k++) raw[k].position = from + ((to - from) * (k - i + 1)) / (j - i + 1);
  }
  g.stops = raw.map((r) => ({ position: Math.min(1, Math.max(0, r.position!)), color: r.color }));
  if (type === 'linear') delete g.type;
  return g;
}

const GENERIC_FAMILIES = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|math|emoji|fangsong|ui-[a-z-]+|-apple-system|BlinkMacSystemFont)$/i;

/** CSS font stack → named families in order (`"Cooper BT", system-ui` → ["Cooper BT"]). */
export function parseFontStack(s: string): string[] {
  return s.split(',').map((f) => f.trim().replace(/^['"]|['"]$/g, '').trim())
    .filter((f) => f && !GENERIC_FAMILIES.test(f));
}

/** `12px`, `50%`, `calc(50% - 7.5px)` → px plus a fraction of the reference size. */
export function parseOffset(v: string | number, fontSize = 16): { px: number; pct: number } | null {
  if (typeof v === 'number') return Number.isFinite(v) ? { px: v, pct: 0 } : null;
  let s = v.trim();
  const calc = /^calc\((.*)\)$/i.exec(s);
  if (calc) s = calc[1];
  s = s.replace(/\s+/g, '');
  const term = /([+-]?)(\d*\.?\d+)(px|%|rem|em)?/y;
  let px = 0;
  let pct = 0;
  let terms = 0;
  for (let i = 0; i < s.length; i = term.lastIndex) {
    term.lastIndex = i;
    const m = term.exec(s);
    if (!m) return null;
    const n = parseFloat(m[2]) * (m[1] === '-' ? -1 : 1);
    if (m[3] === '%') pct += n / 100;
    else px += n * (m[3] === 'rem' ? 16 : m[3] === 'em' ? fontSize : 1);
    terms++;
  }
  if (terms === 0 || (terms > 1 && !calc)) return null;
  return { px, pct };
}

/** `translate` value (`-50%`, `10px -50%`) → px plus a fraction of the node's own size. */
export function parseTranslate(x: string, y = '0'): NonNullable<NormalizedStyle['translate']> | null {
  const a = parseOffset(x);
  const b = parseOffset(y);
  return a && b ? { x: a.px, y: b.px, xPct: a.pct, yPct: b.pct } : null;
}

/** `grid-template-columns` value → tracks: `1fr 200px`, `repeat(12, minmax(0, 1fr))`, `auto`. */
export function parseTracks(v: string): GridTrack[] | null {
  const out: GridTrack[] = [];
  for (const part of splitTop(v.trim())) {
    const rep = /^repeat\(\s*(\d+)\s*,(.+)\)$/.exec(part);
    if (rep) {
      const inner = parseTracks(rep[2]);
      if (!inner) return null;
      for (let i = 0; i < Number(rep[1]); i++) out.push(...inner);
      continue;
    }
    const mm = /^minmax\(.+,(.+)\)$/.exec(part);
    const t = (mm ? mm[1] : part).trim();
    let m: RegExpExecArray | null;
    if ((m = /^(\d*\.?\d+)fr$/.exec(t))) out.push({ fr: parseFloat(m[1]) });
    else if ((m = /^(\d*\.?\d+)(px|rem)?$/.exec(t))) out.push({ px: parseFloat(m[1]) * (m[2] === 'rem' ? 16 : 1) });
    else if (/^(auto|min-content|max-content|fit-content\(.*\))$/.test(t)) out.push('auto');
    else return null;
  }
  return out.length ? out : null;
}

/** `grid-column` value (`1 / span 7`, `2 / 4`, `span 3`) → 1-based start and span. */
export function parseGridLine(v: string): { start?: number; span?: number } | null {
  const [a, b] = v.split('/').map((p) => p.trim());
  const line = (p: string | undefined) => (p && /^-?\d+$/.test(p) ? Number(p) : undefined);
  const span = (p: string | undefined) => { const m = p ? /^span\s+(\d+)$/.exec(p) : null; return m ? Number(m[1]) : undefined; };
  if (!a || (a !== 'auto' && line(a) === undefined && span(a) === undefined)) return null;
  const start = line(a);
  let n = span(a) ?? span(b);
  const end = line(b);
  if (n === undefined && start !== undefined && end !== undefined && end > start) n = end - start;
  return { start, span: n };
}

export type Sides<T> = [T | undefined, T | undefined, T | undefined, T | undefined];
export const SIDE_INDEX: Record<string, number[]> = { '': [0, 1, 2, 3], t: [0], r: [1], b: [2], l: [3], x: [1, 3], y: [0, 2] };

const sameColor = (a: RGBA, b: RGBA) =>
  Math.abs(a.r - b.r) < 0.02 && Math.abs(a.g - b.g) < 0.02 && Math.abs(a.b - b.b) < 0.02 && Math.abs(a.a - b.a) < 0.02;

/**
 * Per-side CSS border widths and colors → one Figma stroke with per-side weights. A side whose color is
 * fully transparent draws nothing. Figma has one stroke color, so `mixed` lists the sides whose color was dropped.
 */
export function resolveBorder(w: Sides<number>, c: Sides<RGBA>, fallback: RGBA): { border?: NonNullable<NormalizedStyle['border']>; mixed: number[] } {
  const widths = w.map((n, i) => (c[i]?.a === 0 ? 0 : n ?? 0)) as [number, number, number, number];
  const visible = [0, 1, 2, 3].filter((i) => widths[i] > 0);
  if (!visible.length) return { mixed: [] };
  const color = c[visible[0]] ?? fallback;
  const mixed = visible.filter((i) => !sameColor(c[i] ?? fallback, color));
  const width = Math.max(...widths);
  const border: NonNullable<NormalizedStyle['border']> = { width, color };
  if (widths.some((n) => n !== width)) border.sides = widths;
  return { border, mixed };
}

function toKebabless(k: string): string {
  return k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

export function inlineToStyle(obj: Record<string, string | number>): { style: NormalizedStyle; unsupported: string[] } {
  const style: NormalizedStyle = {};
  const unsupported: string[] = [];
  const raw: Record<string, string | number> = {};
  for (const k of Object.keys(obj)) raw[toKebabless(k)] = obj[k];

  let fontSize = 16;
  const borderW: Sides<number> = [undefined, undefined, undefined, undefined];
  const borderC: Sides<RGBA> = [undefined, undefined, undefined, undefined];
  const borderCKey: Sides<string> = [undefined, undefined, undefined, undefined];
  const SIDE_KEYS: Record<string, string> = { Top: 't', Right: 'r', Bottom: 'b', Left: 'l' };
  let borderStyle: BorderStyle | undefined;
  const margin: Sides<number | 'auto'> = [undefined, undefined, undefined, undefined];
  const setMargin = (sides: number[], v: string | number, key: string) => {
    const sv = String(v).trim();
    if (sv === 'auto') { for (const i of sides) margin[i] = 'auto'; return; }
    const l = parseLen(v);
    if (!l || !('px' in l)) { unsupported.push(key); return; }
    for (const i of sides) margin[i] = l.px;
  };
  const fit: ImageFit = {};
  const layers: BgLayer[] = [];
  const adjust: ImageAdjust = {};
  const setBorder = (side: string, w: number | undefined, c: RGBA | undefined, key: string) => {
    for (const i of SIDE_INDEX[side]) {
      if (w !== undefined) borderW[i] = w;
      if (c !== undefined) { borderC[i] = c; borderCKey[i] = key; }
    }
  };
  const parseLen = (v: string | number, allowFill = false): Len => {
    if (typeof v === 'number') return Number.isFinite(v) ? { px: v } : null;
    const s = v.trim();
    if (s === '0') return { px: 0 };
    const m = /^(-?\d*\.?\d+)(px|rem|em|%)?$/.exec(s);
    if (!m) return null;
    const n = parseFloat(m[1]);
    switch (m[2]) {
      case undefined:
      case 'px': return { px: n };
      case 'rem': return { px: n * 16 };
      case 'em': return { px: n * fontSize };
      case '%': return allowFill && n === 100 ? { fill: true } : null;
    }
    return null;
  };
  const px = (key: string, v: string | number): number | undefined => {
    const l = parseLen(v);
    if (l && 'px' in l) return l.px;
    unsupported.push(key);
    return undefined;
  };
  const color = (key: string, v: string | number): RGBA | undefined => {
    const c = parseCssColor(String(v));
    if (!c) { unsupported.push(key); return undefined; }
    return c;
  };
  const box4 = (v: string | number, key: string): [number, number, number, number] | undefined => {
    const parts = typeof v === 'number' ? [v] : splitTop(v);
    if (parts.length < 1 || parts.length > 4) { unsupported.push(key); return undefined; }
    const nums: number[] = [];
    for (const p of parts) {
      const l = parseLen(p);
      if (!l || !('px' in l)) { unsupported.push(key); return undefined; }
      nums.push(l.px);
    }
    const [a, b = a, c = a, d = b] = nums;
    return [a, b, c, d];
  };

  if ('fontSize' in raw) {
    const l = typeof raw.fontSize === 'string' && /em$/.test(raw.fontSize) && !/rem$/.test(raw.fontSize)
      ? null : parseLen(raw.fontSize);
    if (l && 'px' in l) { fontSize = l.px; style.fontSize = l.px; } else unsupported.push('fontSize');
  }

  for (const key of Object.keys(raw)) {
    const v = raw[key];
    const sv = String(v).trim();
    switch (key) {
      case 'fontSize': break;
      case 'display':
        if (sv === 'flex' || sv === 'block' || sv === 'grid' || sv === 'none') style.display = sv;
        else if (sv === 'inline-flex') { style.display = 'flex'; style.inline = true; }
        else if (sv === 'inline-block' || sv === 'inline') { style.display = 'block'; style.inline = true; }
        else if (sv === '-webkit-box' || sv === 'flow-root' || sv === 'list-item') style.display = 'block'; // line-clamp boxes
        else unsupported.push(key);
        break;
      case 'flexDirection':
        if (sv === 'row' || sv === 'column') style.direction = sv;
        else unsupported.push(key);
        break;
      case 'flexWrap':
        style.wrap = sv === 'wrap';
        break;
      case 'justifyContent': {
        const m: Record<string, NormalizedStyle['justify']> = {
          'flex-start': 'start', start: 'start', center: 'center', 'flex-end': 'end', end: 'end', 'space-between': 'between',
          'space-around': 'around', 'space-evenly': 'evenly',
        };
        if (m[sv]) style.justify = m[sv]; else unsupported.push(key);
        break;
      }
      case 'alignItems': {
        const m: Record<string, NormalizedStyle['align']> = {
          'flex-start': 'start', start: 'start', center: 'center', 'flex-end': 'end', end: 'end', stretch: 'stretch', baseline: 'baseline',
        };
        if (m[sv]) style.align = m[sv]; else unsupported.push(key);
        break;
      }
      case 'gap': { const n = px(key, v); if (n !== undefined) style.gap = n; break; }
      case 'flex':
        if (sv === '1' || /^1\s+1\s+(0|0px|0%)$/.test(sv) || sv === '1 1 0%') {
          style.widthSizing = 'FILL';
        } else unsupported.push(key);
        break;
      case 'padding': {
        const b = box4(v, key);
        if (b) style.padding = { top: b[0], right: b[1], bottom: b[2], left: b[3] };
        break;
      }
      case 'paddingBlock': case 'paddingInline': {
        const parts = typeof v === 'number' ? [v] : splitTop(v);
        const nums = parts.map((p) => parseLen(p));
        if (parts.length < 1 || parts.length > 2 || nums.some((l) => !l || !('px' in l))) { unsupported.push(key); break; }
        const [a, b = a] = nums.map((l) => (l as { px: number }).px);
        const p = (style.padding ??= { top: 0, right: 0, bottom: 0, left: 0 });
        if (key === 'paddingBlock') { p.top = a; p.bottom = b; } else { p.left = a; p.right = b; }
        break;
      }
      case 'paddingTop': case 'paddingRight': case 'paddingBottom': case 'paddingLeft': {
        const n = px(key, v);
        if (n !== undefined) {
          const p = (style.padding ??= { top: 0, right: 0, bottom: 0, left: 0 });
          p[key.slice(7).toLowerCase() as 'top' | 'right' | 'bottom' | 'left'] = n;
        }
        break;
      }
      case 'width': case 'height': {
        if (/^(max-content|min-content|fit-content|auto)$/.test(sv)) {
          style[key === 'width' ? 'widthSizing' : 'heightSizing'] = 'HUG';
          break;
        }
        const l = parseLen(v, true);
        const sizing = key === 'width' ? 'widthSizing' : 'heightSizing';
        const o = !l ? parseOffset(v, fontSize) : null;
        if (o && o.pct > 0) { style[key === 'width' ? 'widthPct' : 'heightPct'] = { pct: o.pct, px: o.px }; break; }
        if (!l) unsupported.push(key);
        else if ('fill' in l) style[sizing] = 'FILL' as Sizing;
        else { style[key] = l.px; style[sizing] = 'FIXED'; }
        break;
      }
      case 'backgroundClip': case 'WebkitBackgroundClip':
        if (sv === 'text') style.clipText = true;
        break;
      case 'flexBasis': {
        if (sv === 'auto' || sv === '0' || sv === '0%') break;
        const n = px(key, v);
        if (n !== undefined) style.basis = n;
        break;
      }
      case 'alignSelf': {
        const m: Record<string, NormalizedStyle['alignSelf']> = {
          'flex-start': 'start', start: 'start', 'self-start': 'start', center: 'center', 'flex-end': 'end', end: 'end', 'self-end': 'end',
        };
        if (m[sv]) style.alignSelf = m[sv]; else if (sv !== 'auto' && sv !== 'stretch') unsupported.push(key);
        break;
      }
      case 'gridTemplateColumns': case 'gridTemplateRows': {
        const tracks = parseTracks(sv);
        if (!tracks) { unsupported.push(key); break; }
        const g = (style.grid ??= { cols: [], rows: [] });
        if (key === 'gridTemplateColumns') g.cols = tracks; else g.rows = tracks;
        break;
      }
      case 'columnGap': case 'rowGap': {
        const n = px(key, v);
        if (n === undefined) break;
        const g = (style.grid ??= { cols: [], rows: [] });
        if (key === 'columnGap') g.colGap = n; else g.rowGap = n;
        break;
      }
      case 'gridColumn': case 'gridRow': {
        const l = parseGridLine(sv);
        if (!l) { unsupported.push(key); break; }
        const it = (style.gridItem ??= {});
        if (key === 'gridColumn') { it.colStart = l.start; it.colSpan = l.span; } else { it.rowStart = l.start; it.rowSpan = l.span; }
        break;
      }
      case 'filter': {
        // blur() and drop-shadow() map to effects, opacity() to opacity; brightness/contrast/saturate/grayscale
        // adjust image fills. hue-rotate, invert and sepia have no Figma equivalent.
        const shadows: NonNullable<NormalizedStyle['shadows']> = [];
        let bad = false;
        for (const fn of splitTop(sv)) {
          const blur = /^blur\((.*)\)$/.exec(fn);
          if (blur) {
            const l = parseLen(blur[1]);
            if (l && 'px' in l) style.blur = l.px; else bad = true;
            continue;
          }
          const f = /^(brightness|contrast|saturate|grayscale|opacity)\((.*)\)$/.exec(fn);
          if (f) {
            if (f[1] === 'opacity') { const n = amount(f[2]); if (n === null) bad = true; else style.opacity = (style.opacity ?? 1) * n; }
            else if (!addImageFilter(adjust, f[1], f[2])) bad = true;
            continue;
          }
          const m = /^drop-shadow\((.*)\)$/.exec(fn);
          if (!m) { bad = true; continue; }
          const nums: number[] = [];
          let col: RGBA | undefined;
          for (const p of splitTop(m[1])) {
            const l = parseLen(p);
            if (l && 'px' in l) nums.push(l.px);
            else { const c = parseCssColor(p); if (c) col = c; else bad = true; }
          }
          if (nums.length < 2 || nums.length > 3) { bad = true; continue; }
          shadows.push({ x: nums[0], y: nums[1], blur: nums[2] ?? 0, spread: 0, color: col ?? { r: 0, g: 0, b: 0, a: 1 } });
        }
        if (bad && sv !== 'none') unsupported.push(key);
        if (shadows.length) style.shadows = [...(style.shadows ?? []), ...shadows];
        break;
      }
      case 'margin': {
        const parts = typeof v === 'number' ? [v] : splitTop(sv);
        if (parts.length < 1 || parts.length > 4) { unsupported.push(key); break; }
        const [a, b = a, c = a, d = b] = parts;
        [a, b, c, d].forEach((p, i) => setMargin([i], p, key));
        break;
      }
      case 'marginTop': case 'marginRight': case 'marginBottom': case 'marginLeft':
        setMargin(SIDE_INDEX[SIDE_KEYS[key.slice(6)]], v, key);
        break;
      case 'marginInline': case 'marginBlock': {
        const parts = typeof v === 'number' ? [v] : splitTop(sv);
        if (parts.length < 1 || parts.length > 2) { unsupported.push(key); break; }
        const [a, b = a] = parts;
        const [s1, s2] = key === 'marginInline' ? [3, 1] : [0, 2];
        setMargin([s1], a, key);
        setMargin([s2], b, key);
        break;
      }
      case 'marginInlineStart': case 'marginInlineEnd': case 'marginBlockStart': case 'marginBlockEnd':
        setMargin([{ marginInlineStart: 3, marginInlineEnd: 1, marginBlockStart: 0, marginBlockEnd: 2 }[key]!], v, key);
        break;
      case 'maxHeight': {
        if (sv === 'none') break;
        const n = px(key, v);
        if (n !== undefined) style.maxHeight = n;
        break;
      }
      case 'aspectRatio': {
        if (sv === 'auto') break;
        const r = parseAspectRatio(sv);
        if (r) style.aspectRatio = r; else unsupported.push(key);
        break;
      }
      case 'textShadow': {
        if (sv === 'none') break;
        const { shadows, bad } = parseShadows(sv, true);
        if (bad) unsupported.push(key);
        if (shadows.length) style.textShadows = shadows;
        break;
      }
      case 'mixBlendMode': {
        if (sv === 'normal') break;
        const b = parseBlendMode(sv);
        if (b) style.blendMode = b; else unsupported.push(key);
        break;
      }
      case 'scale': {
        if (sv === 'none') break;
        const parts = splitTop(sv);
        const n = parts.map((p) => /%$/.test(p) ? parseFloat(p) / 100 : Number(p));
        if (n.some((x) => !Number.isFinite(x)) || (n.length > 1 && n.some((x) => x !== n[0]))) unsupported.push(key);
        else style.scale = n[0];
        break;
      }
      case 'WebkitLineClamp': case 'lineClamp': {
        const n = Number(v);
        if (Number.isInteger(n) && n > 0) style.maxLines = n; else if (sv !== 'none') unsupported.push(key);
        break;
      }
      case 'textOverflow':
        // Only visible on text that can't wrap; Figma truncates to the lines set by line-clamp, else one.
        if (sv === 'ellipsis') style.maxLines ??= 1; else if (sv !== 'clip') unsupported.push(key);
        break;
      case 'borderStyle': {
        const st = splitTop(sv)[0];
        if (st === 'dashed' || st === 'dotted' || st === 'solid') borderStyle = st;
        else if (st === 'none' || st === 'hidden') borderW.fill(0);
        break;
      }
      case 'backgroundRepeat':
        fit.repeat = /^(repeat|round|space|repeat-x|repeat-y)(\s|$)/.test(sv);
        break;
      case 'backgroundSize': case 'objectFit': {
        if (key === 'objectFit' && (sv === 'fill' || sv === 'none' || sv === 'scale-down')) {
          if (sv === 'fill') fit.stretch = true; else fit.size = sv === 'none' ? { w: 'auto', h: 'auto' } : 'contain';
          break;
        }
        const size = parseImageSize(sv);
        if (size) fit.size = size; else unsupported.push(key);
        break;
      }
      case 'backgroundPosition': case 'objectPosition': {
        const pos = parsePosition(sv);
        if (pos) fit.position = pos; else unsupported.push(key);
        break;
      }
      case 'backdropFilter': case 'WebkitBackdropFilter': {
        if (sv === 'none') break;
        const m = /^blur\((.*)\)$/.exec(sv);
        const l = m ? parseLen(m[1]) : null;
        if (l && 'px' in l) style.backdropBlur = l.px; else unsupported.push(key);
        break;
      }
      case 'minHeight': {
        const n = px(key, v);
        if (n !== undefined) style.minHeight = n;
        break;
      }
      case 'minWidth': case 'maxWidth': {
        const n = px(key, v);
        if (n !== undefined) style[key] = n;
        break;
      }
      case 'position':
        if (sv === 'absolute' || sv === 'relative') style.position = sv; else unsupported.push(key);
        break;
      case 'top': case 'left': case 'right': case 'bottom': {
        if (sv === 'auto') break;
        const o = parseOffset(v, fontSize);
        if (!o) { unsupported.push(key); break; }
        style[key] = o.px;
        if (o.pct) (style.insetPct ??= {})[key] = o.pct;
        break;
      }
      case 'translate': {
        if (sv === 'none') break;
        const parts = splitTop(sv);
        const t = parts.length <= 2 ? parseTranslate(parts[0], parts[1]) : null;
        if (t) style.translate = t; else unsupported.push(key);
        break;
      }
      case 'background': case 'backgroundColor': case 'backgroundImage': {
        if (/gradient\(|url\(/.test(sv)) {
          // Layers are comma-separated; keep the first url() and the first linear gradient.
          let ok = false;
          for (const layer of splitTop(sv, /,/)) {
            const l = layer.trim();
            const url = /^url\(\s*(['"]?)(.+?)\1\s*\)/.exec(l);
            if (url) { style.imageUrl ??= url[2]; layers.push({ url: url[2] }); ok = true; continue; }
            const g = /^(repeating-)?(linear|radial|conic)-gradient\(/.test(l) ? parseGradient(l) : null;
            if (g) { style.gradient ??= g; layers.push({ gradient: g }); ok = true; }
          }
          if (!ok) unsupported.push(key);
          break;
        }
        if (key === 'backgroundImage') {
          if (sv !== 'none') unsupported.push(key);
          break;
        }
        const c = color(key, v);
        if (c) style.background = c;
        break;
      }
      case 'borderRadius': {
        if (/^\d*\.?\d+%$/.test(sv) && parseFloat(sv) >= 50) { style.radius = 9999; break; }
        const b = box4(v, key);
        if (b) style.radius = b[0] === b[1] && b[1] === b[2] && b[2] === b[3] ? b[0] : b;
        break;
      }
      case 'border': case 'borderTop': case 'borderRight': case 'borderBottom': case 'borderLeft': {
        const side = SIDE_KEYS[key.slice(6)] ?? '';
        if (sv === 'none' || sv === '0') { setBorder(side, 0, undefined, key); break; }
        let width: number | undefined;
        let col: RGBA | undefined;
        let bad = false;
        for (const p of splitTop(sv)) {
          const l = parseLen(p);
          if (l && 'px' in l) { width = l.px; continue; }
          if (p === 'dashed' || p === 'dotted') { borderStyle = p; continue; }
          if (/^(solid|none|hidden|double|groove|ridge|inset|outset)$/.test(p)) continue;
          const c = parseCssColor(p);
          if (c) col = c; else bad = true;
        }
        if (bad || width === undefined) { unsupported.push(key); break; }
        setBorder(side, width, col ?? { r: 0, g: 0, b: 0, a: 1 }, key);
        break;
      }
      case 'boxShadow': {
        if (sv === 'none') break;
        const { shadows, bad } = parseShadows(sv);
        if (bad) unsupported.push(key);
        if (shadows.length) style.shadows = shadows;
        break;
      }
      case 'borderWidth': {
        const b = box4(v, key);
        if (b) b.forEach((n, i) => { borderW[i] = n; });
        break;
      }
      case 'borderColor': {
        // 1-4 values like padding: t, r, b, l.
        const parts = typeof v === 'number' ? [] : splitTop(sv);
        const cols = parts.map((p) => parseCssColor(p));
        if (!parts.length || parts.length > 4 || cols.some((c) => !c)) { unsupported.push(key); break; }
        const [t, r = t, b = t, l = r] = cols as RGBA[];
        [t, r, b, l].forEach((c, i) => { borderC[i] = c; borderCKey[i] = key; });
        break;
      }
      case 'borderTopWidth': case 'borderRightWidth': case 'borderBottomWidth': case 'borderLeftWidth': {
        const n = px(key, v);
        if (n !== undefined) setBorder(SIDE_KEYS[key.slice(6, -5)], n, undefined, key);
        break;
      }
      case 'borderTopColor': case 'borderRightColor': case 'borderBottomColor': case 'borderLeftColor': {
        const c = color(key, v);
        if (c) setBorder(SIDE_KEYS[key.slice(6, -5)], undefined, c, key);
        break;
      }
      case 'rotate': {
        const a = parseAngle(sv);
        if (a !== null) style.rotation = a; else if (sv !== 'none') unsupported.push(key);
        break;
      }
      case 'transform': {
        if (sv === 'none') break;
        let ok = true;
        let m3: Mat = IDENTITY;
        let linear = false;
        for (const fn of splitTop(sv)) {
          const m = /^([a-zA-Z0-9]+)\((.*)\)$/.exec(fn);
          const name = m?.[1] ?? '';
          const args = m ? splitTop(m[2], /,/).map((a) => a.trim()) : [];
          const ang = (i: number) => parseAngle(args[i] ?? '') ?? (args[i] === '0' ? 0 : null);
          const num = (i: number) => amount(args[i], NaN) ?? NaN;
          let t: Mat | null = null;
          if (name === 'translate' || name === 'translateX' || name === 'translateY') {
            const tr = name === 'translate' ? parseTranslate(args[0] ?? '', args[1])
              : name === 'translateX' ? parseTranslate(args[0] ?? '') : parseTranslate('0', args[0] ?? '');
            if (tr) style.translate = tr; else ok = false;
            continue;
          }
          if (name === 'translateZ' || name === 'perspective') { if (name === 'perspective') ok = false; continue; }
          if (name === 'rotate' || name === 'rotateZ') t = ang(0) !== null ? rotateMat(ang(0)!) : null;
          // 3D rotations without perspective flatten to a squash along one axis.
          else if (name === 'rotateX') t = ang(0) !== null ? scaleMat(1, Math.cos(rad(ang(0)!))) : null;
          else if (name === 'rotateY') t = ang(0) !== null ? scaleMat(Math.cos(rad(ang(0)!)), 1) : null;
          else if (name === 'scale') t = Number.isFinite(num(0)) ? scaleMat(num(0), args.length > 1 ? num(1) : num(0)) : null;
          else if (name === 'scaleX') t = Number.isFinite(num(0)) ? scaleMat(num(0), 1) : null;
          else if (name === 'scaleY') t = Number.isFinite(num(0)) ? scaleMat(1, num(0)) : null;
          else if (name === 'skew') t = ang(0) !== null ? skewMat(ang(0)!, args.length > 1 ? ang(1) ?? NaN : 0) : null;
          else if (name === 'skewX') t = ang(0) !== null ? skewMat(ang(0)!, 0) : null;
          else if (name === 'skewY') t = ang(0) !== null ? skewMat(0, ang(0)!) : null;
          else if (name === 'matrix' && args.length === 6) {
            const n = args.map(Number);
            if (n.every(Number.isFinite)) {
              t = [n[0], n[1], n[2], n[3]];
              const tr = style.translate ?? { x: 0, y: 0, xPct: 0, yPct: 0 };
              style.translate = { ...tr, x: tr.x + n[4], y: tr.y + n[5] };
            }
          }
          if (!t || t.some((x) => !Number.isFinite(x))) { ok = false; continue; }
          m3 = mulMat(m3, t);
          linear = true;
        }
        // Translate-only transforms leave a separate `rotate`/`scale` property alone.
        if (linear) setMatrix(style, m3);
        if (!ok) unsupported.push(key);
        break;
      }
      case 'transformOrigin':
        style.transformOrigin = /^(0(%|px)?|left|top)\s+(0(%|px)?|left|top)$/.test(sv) || /^(top left|left top)$/.test(sv)
          ? 'top-left' : 'center';
        break;
      case 'whiteSpace':
        // Text that never wraps hugs its content.
        if (/^(pre|nowrap)$/.test(sv) && style.width === undefined) style.widthSizing ??= 'HUG';
        break;
      case 'opacity': {
        const n = Number(v);
        if (Number.isFinite(n)) style.opacity = n; else unsupported.push(key);
        break;
      }
      case 'overflow':
        style.overflowHidden = sv === 'hidden' || sv === 'clip';
        break;
      case 'color': { const c = color(key, v); if (c) style.color = c; break; }
      case 'fontFamily': {
        const stack = parseFontStack(sv);
        if (!stack.length) break;
        style.fontFamily = stack[0];
        style.fontFallbacks = stack.slice(1);
        break;
      }
      case 'fontWeight': {
        const n = sv === 'bold' ? 700 : sv === 'normal' ? 400 : Number(sv);
        if (Number.isFinite(n)) style.fontWeight = n; else unsupported.push(key);
        break;
      }
      case 'fontStyle':
        if (sv === 'italic' || sv === 'normal') style.fontStyle = sv; else unsupported.push(key);
        break;
      case 'lineHeight': {
        if (sv === 'normal') { style.lineHeight = 'auto'; break; }
        // unitless number multiplies font size
        if (typeof v === 'number' || /^\d*\.?\d+$/.test(sv)) { style.lineHeight = Number(v) * fontSize; break; }
        if (/^\d*\.?\d+%$/.test(sv)) { style.lineHeight = (parseFloat(sv) / 100) * fontSize; break; }
        const n = px(key, v);
        if (n !== undefined) style.lineHeight = n;
        break;
      }
      case 'letterSpacing': {
        if (sv === 'normal') { style.letterSpacing = 0; break; }
        const n = px(key, v);
        if (n !== undefined) style.letterSpacing = n;
        break;
      }
      case 'textAlign':
        if (['left', 'center', 'right', 'justify'].includes(sv)) style.textAlign = sv as NormalizedStyle['textAlign'];
        else unsupported.push(key);
        break;
      case 'textTransform':
        if (sv === 'uppercase') style.textTransform = 'upper';
        else if (sv === 'lowercase') style.textTransform = 'lower';
        else if (sv === 'none') style.textTransform = 'none';
        else unsupported.push(key);
        break;
      case 'textDecoration': case 'textDecorationLine': {
        // Shorthand like `underline 1px oklch(...)`: only the line type is modelled.
        const line = splitTop(sv).find((p) => p === 'underline' || p === 'line-through' || p === 'none');
        if (line) style.textDecoration = line as NormalizedStyle['textDecoration'];
        else unsupported.push(key);
        break;
      }
      default:
        if (!IGNORED.has(key)) unsupported.push(key);
    }
  }
  // margin: 0 (a common reset) is the same as no margin.
  if (margin.some((m) => m !== undefined && m !== 0)) {
    const n = (m: number | 'auto' | undefined) => (typeof m === 'number' ? m : 0);
    style.margin = { top: n(margin[0]), right: n(margin[1]), bottom: n(margin[2]), left: n(margin[3]) };
    if (margin[1] === 'auto' && margin[3] === 'auto') style.margin.autoX = true;
  }
  if (fit.size || fit.position || fit.stretch || fit.repeat) style.imageFit = fit;
  if (layers.length > 1) style.layers = layers;
  if (Object.keys(adjust).length) style.imageFilters = adjust;
  if (borderW.some((w) => w !== undefined)) {
    // CSS's default border color is currentColor.
    const { border, mixed } = resolveBorder(borderW, borderC, style.color ?? { r: 0, g: 0, b: 0, a: 1 });
    if (border) style.border = border;
    if (border && borderStyle && borderStyle !== 'solid') border.style = borderStyle;
    for (const i of mixed) if (borderCKey[i] && !unsupported.includes(borderCKey[i]!)) unsupported.push(borderCKey[i]!);
  }
  return { style, unsupported };
}
