import type { NormalizedStyle, RGBA } from './types';
import { parseCssColor, tailwindColor, withAlpha } from './colors';
import { inlineToStyle, parseFontStack, parseLinearGradient, parseOffset, parseTracks } from './inlineStyle';

const TEXT_SIZES: Record<string, [number, number]> = {
  xs: [12, 16], sm: [14, 20], base: [16, 24], lg: [18, 28], xl: [20, 28],
  '2xl': [24, 32], '3xl': [30, 36], '4xl': [36, 40], '5xl': [48, 48],
  '6xl': [60, 60], '7xl': [72, 72], '8xl': [96, 96], '9xl': [128, 128],
};
const FONT_WEIGHTS: Record<string, number> = {
  thin: 100, extralight: 200, light: 300, normal: 400, medium: 500,
  semibold: 600, bold: 700, extrabold: 800, black: 900,
};
const FONT_FAMILIES: Record<string, string> = { sans: 'Inter', serif: 'Georgia', mono: 'Roboto Mono' };
const LEADING: Record<string, number> = { none: 1, tight: 1.25, snug: 1.375, normal: 1.5, relaxed: 1.625, loose: 2 };
const TRACKING: Record<string, number> = { tighter: -0.05, tight: -0.025, normal: 0, wide: 0.025, wider: 0.05, widest: 0.1 };
const RADII: Record<string, number> = { none: 0, xs: 2, sm: 2, DEFAULT: 4, md: 6, lg: 8, xl: 12, '2xl': 16, '3xl': 24, full: 9999 };
/** Container scale: `max-w-*`, and in Tailwind v4 also `w-*` / `min-w-*` (`w-7xl` = 80rem). */
const MAX_W: Record<string, number> = {
  '3xs': 256, '2xs': 288, xs: 320, sm: 384, md: 448, lg: 512, xl: 576, '2xl': 672, '3xl': 768,
  '4xl': 896, '5xl': 1024, '6xl': 1152, '7xl': 1280, prose: 640,
};
type Shadow = NonNullable<NormalizedStyle['shadows']>[number];
const sh = (y: number, blur: number, spread: number, a: number): Shadow =>
  ({ x: 0, y, blur, spread, color: { r: 0, g: 0, b: 0, a } });
const SHADOWS: Record<string, Shadow | null> = {
  sm: sh(1, 2, 0, 0.05), DEFAULT: sh(1, 3, 0, 0.1), md: sh(4, 6, -1, 0.1), lg: sh(10, 15, -3, 0.1),
  xl: sh(20, 25, -5, 0.1), '2xl': sh(25, 50, -12, 0.25), none: null,
};
const GRADIENT_DIRS: Record<string, number> = { t: 0, tr: 45, r: 90, br: 135, b: 180, bl: 225, l: 270, tl: 315 };
/** Classes with no visual effect in Figma (rendering hints, box model, wrapping, interaction). */
const IGNORED = /^(antialiased|subpixel-antialiased|shrink(-0)?|flex-shrink(-0)?|grow-0|flex-grow-0|box-(border|content)|wrap-(anywhere|break-word|normal)|break-(words|all|normal|keep)|origin-.+|border-(solid|dashed|dotted|double|none)|cursor-.+|select-.+|pointer-events-.+|transition(-.+)?|duration-.+|ease-.+|delay-.+|will-change-.+|isolate|outline-none|whitespace-normal|list-none|static|z-.+|content-(center|start|end|between|around|evenly|stretch|normal)|bg-(no-repeat|repeat|cover|contain|center|top|bottom|left|right)|bg-(size|position)-.+|row-end-auto|col-end-auto|row-start-auto|col-start-auto|self-auto|grid-flow-row)$/;

const DEFAULT_BORDER_COLOR: RGBA = { r: 0xe5 / 255, g: 0xe7 / 255, b: 0xeb / 255, a: 1 };

/** Split off a top-level (outside []) separator; returns index of last such char or -1. */
function lastTop(s: string, ch: string): number {
  let depth = 0;
  let idx = -1;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '[') depth++;
    else if (s[i] === ']') depth--;
    else if (depth === 0 && s[i] === ch) idx = i;
  }
  return idx;
}

/** Spacing-scale or arbitrary length value to px. */
function length(v: string): number | null {
  if (v === 'px') return 1;
  if (v === '0') return 0;
  if (/^\d+(\.\d+)?$/.test(v)) return parseFloat(v) * 4;
  return arbLength(v);
}
function arbLength(v: string): number | null {
  const m = /^\[(-?\d*\.?\d+)(px|rem)?\]$/.exec(v);
  if (!m) return null;
  return parseFloat(m[1]) * (m[2] === 'rem' ? 16 : 1);
}

function colorValue(v: string): RGBA | null {
  const slash = lastTop(v, '/');
  const name = slash >= 0 ? v.slice(0, slash) : v;
  let c: RGBA | null;
  if (name.startsWith('[') && name.endsWith(']')) c = parseCssColor(name.slice(1, -1).replace(/_/g, ' '));
  else c = tailwindColor(name);
  if (!c) return null;
  if (slash >= 0) {
    const a = v.slice(slash + 1);
    let n: number;
    if (/^\d+(\.\d+)?$/.test(a)) n = parseFloat(a) / 100;
    else if (/^\[\d*\.?\d+\]$/.test(a)) n = parseFloat(a.slice(1, -1));
    else return null;
    c = withAlpha(c, n);
  }
  return c;
}

export function tailwindToStyle(className: string): { style: NormalizedStyle; unsupported: string[] } {
  const style: NormalizedStyle = {};
  const unsupported: string[] = [];

  let gap: number | undefined;
  let gapX: number | undefined;
  let gapY: number | undefined;
  const pad: { top?: number; right?: number; bottom?: number; left?: number } = {};
  const corners: [number, number, number, number] = [0, 0, 0, 0];
  let radiusSet = false;
  let borderWidth: number | undefined;
  let borderColor: RGBA | undefined;
  let defaultLineHeight: number | undefined;
  let leading: { mult: number } | { px: number } | undefined;
  let tracking: number | undefined;
  let trackingPx: number | undefined;
  let gradAngle: number | undefined;
  let gradFrom: RGBA | undefined;
  let gradVia: RGBA | undefined;
  let gradTo: RGBA | undefined;
  const tracks: { cols?: NonNullable<NormalizedStyle['grid']>['cols']; rows?: NonNullable<NormalizedStyle['grid']>['rows'] } = {};
  const line: { colStart?: number; colEnd?: number; colSpan?: number; rowStart?: number; rowEnd?: number; rowSpan?: number } = {};

  const setSize = (axis: 'width' | 'height', val: string): boolean => {
    const sizing = axis === 'width' ? 'widthSizing' : 'heightSizing';
    if (val === 'full' || val === '[100%]') { style[sizing] = 'FILL'; delete style[axis]; return true; }
    if (val === 'fit' || val === 'auto' || val === 'max' || val === 'min') { style[sizing] = 'HUG'; delete style[axis]; return true; }
    if (val === 'screen') { style[axis] = axis === 'width' ? 1440 : 900; style[sizing] = 'FIXED'; return true; }
    const n = axis === 'width' && val in MAX_W ? MAX_W[val] : length(val);
    if (n === null) return false;
    style[axis] = n;
    style[sizing] = 'FIXED';
    return true;
  };

  for (const rawTok of className.split(/\s+/).filter(Boolean)) {
    // variants
    if (lastTop(rawTok, ':') >= 0) { unsupported.push(rawTok); continue; }
    let tok = rawTok;
    if (tok.startsWith('!')) tok = tok.slice(1);
    else if (tok.endsWith('!')) tok = tok.slice(0, -1);
    let neg = false;
    if (tok.startsWith('-')) { neg = true; tok = tok.slice(1); }
    const ok = apply(tok, neg);
    if (!ok) unsupported.push(rawTok);
  }

  function apply(tok: string, neg: boolean): boolean {
    let m: RegExpExecArray | null;
    // Inset/translate value: spacing scale, fraction (`1/2`), `full`, or arbitrary (`[calc(50%-8px)]`).
    const offset = (v: string): { px: number; pct: number } | null => {
      const sign = neg ? -1 : 1;
      let o: { px: number; pct: number } | null = null;
      const frac = /^(\d+)\/(\d+)$/.exec(v);
      if (frac) o = { px: 0, pct: Number(frac[1]) / Number(frac[2]) };
      else if (v === 'full') o = { px: 0, pct: 1 };
      else if (/^\[.+\]$/.test(v)) o = parseOffset(v.slice(1, -1).replace(/_/g, ' '));
      else { const n = length(v); if (n !== null) o = { px: n, pct: 0 }; }
      return o && { px: sign * o.px || 0, pct: sign * o.pct || 0 };
    };
    const num = (v: string): number | null => {
      const n = length(v);
      return n === null ? null : neg ? -n : n;
    };
    if (neg && !/^(top|left|right|bottom|inset(-[xy])?|translate-[xy]|rotate|tracking)-/.test(tok)) return false;

    // arbitrary property: [prop:value]
    if ((m = /^\[([a-z-]+):(.+)\]$/.exec(tok))) return arbitraryProperty(m[1], m[2].replace(/_/g, ' '));

    switch (tok) {
      case 'flex': style.display = 'flex'; return true;
      case 'inline-flex': style.display = 'flex'; style.inline = true; return true;
      case 'block': style.display = 'block'; return true;
      case 'grid': style.display = 'grid'; return true;
      case 'bg-clip-text': style.clipText = true; return true;
      case 'self-center': style.alignSelf = 'center'; return true;
      case 'self-start': style.alignSelf = 'start'; return true;
      case 'self-end': style.alignSelf = 'end'; return true;
      case 'inline-block': case 'inline': style.display = 'block'; style.inline = true; return true;
      case 'hidden': style.display = 'none'; return true;
      case 'flex-row': style.direction = 'row'; return true;
      case 'flex-col': style.direction = 'column'; return true;
      case 'flex-wrap': style.wrap = true; return true;
      case 'flex-nowrap': style.wrap = false; return true;
      case 'flex-1': case 'grow': case 'flex-grow': style.widthSizing = 'FILL'; return true;
      case 'self-stretch': style.heightSizing = 'FILL'; return true;
      case 'relative': case 'absolute': style.position = tok; return true;
      case 'overflow-hidden': case 'overflow-clip': style.overflowHidden = true; return true;
      case 'overflow-visible': style.overflowHidden = false; return true;
      case 'whitespace-nowrap': case 'whitespace-pre':
        if (style.width === undefined) style.widthSizing ??= 'HUG';
        return true;
      case 'whitespace-pre-wrap': case 'whitespace-pre-line': case 'whitespace-break-spaces': return true;
      case 'origin-top-left': style.transformOrigin = 'top-left'; return true;
      case 'origin-center': style.transformOrigin = 'center'; return true;
      case 'italic': style.fontStyle = 'italic'; return true;
      case 'not-italic': style.fontStyle = 'normal'; return true;
      case 'uppercase': style.textTransform = 'upper'; return true;
      case 'lowercase': style.textTransform = 'lower'; return true;
      case 'normal-case': style.textTransform = 'none'; return true;
      case 'underline': style.textDecoration = 'underline'; return true;
      case 'line-through': style.textDecoration = 'line-through'; return true;
      case 'no-underline': style.textDecoration = 'none'; return true;
      case 'border': borderWidth = 1; return true;
      case 'rounded': corners.fill(RADII.DEFAULT); radiusSet = true; return true;
      case 'shadow': return applyShadow('DEFAULT');
    }
    if (IGNORED.test(tok)) return true;

    // gap
    if ((m = /^gap(-x|-y)?-(.+)$/.exec(tok))) {
      const n = num(m[2]);
      if (n === null) return false;
      if (m[1] === '-x') gapX = n; else if (m[1] === '-y') gapY = n; else { gap = n; gapX = undefined; gapY = undefined; }
      return true;
    }
    // padding
    if ((m = /^p([xytrbl])?-(.+)$/.exec(tok))) {
      const n = num(m[2]);
      if (n === null || n < 0) return false;
      const sides: Record<string, ('top' | 'right' | 'bottom' | 'left')[]> = {
        '': ['top', 'right', 'bottom', 'left'], x: ['left', 'right'], y: ['top', 'bottom'],
        t: ['top'], r: ['right'], b: ['bottom'], l: ['left'],
      };
      for (const s of sides[m[1] ?? '']) pad[s] = n;
      return true;
    }
    if ((m = /^justify-(start|center|end|between)$/.exec(tok))) { style.justify = m[1] as NormalizedStyle['justify']; return true; }
    if ((m = /^items-(start|center|end|stretch|baseline)$/.exec(tok))) { style.align = m[1] as NormalizedStyle['align']; return true; }

    // sizing
    if ((m = /^(w|h)-(.+)$/.exec(tok))) return setSize(m[1] === 'w' ? 'width' : 'height', m[2]);
    if ((m = /^size-(.+)$/.exec(tok))) return setSize('width', m[1]) && setSize('height', m[1]);
    if ((m = /^min-w-(.+)$/.exec(tok))) {
      const n = m[1] in MAX_W ? MAX_W[m[1]] : length(m[1]);
      if (n === null) return false;
      style.minWidth = n; return true;
    }
    if ((m = /^min-h-(.+)$/.exec(tok))) {
      const n = length(m[1]);
      if (n === null) return false;
      if (n > 0) style.minHeight = n;
      return true;
    }
    if ((m = /^basis-(.+)$/.exec(tok))) {
      if (m[1] === 'auto' || m[1] === '0') return true;
      const n = m[1] in MAX_W ? MAX_W[m[1]] : length(m[1]);
      if (n === null) return false;
      style.basis = n; return true;
    }
    // grid
    if ((m = /^grid-(cols|rows)-(.+)$/.exec(tok))) {
      const t = /^\d+$/.test(m[2]) ? Array.from({ length: Number(m[2]) }, () => ({ fr: 1 }))
        : /^\[.+\]$/.test(m[2]) ? parseTracks(m[2].slice(1, -1).replace(/_/g, ' ')) : null;
      if (!t) return false;
      tracks[m[1] as 'cols' | 'rows'] = t;
      return true;
    }
    if ((m = /^(col|row)-(start|end|span)-(.+)$/.exec(tok))) {
      const ax = m[1];
      let n: number | null = /^\d+$/.test(m[3]) ? Number(m[3]) : null;
      const sp = /^\[span_(\d+)\]$/.exec(m[3]);
      if (m[2] === 'span' && m[3] === 'full') { line[ax === 'col' ? 'colStart' : 'rowStart'] = 1; line[ax === 'col' ? 'colEnd' : 'rowEnd'] = -1; return true; }
      if (sp && m[2] !== 'start') { line[ax === 'col' ? 'colSpan' : 'rowSpan'] = Number(sp[1]); return true; }
      if (n === null) return false;
      const key = (ax + m[2][0].toUpperCase() + m[2].slice(1)) as keyof typeof line;
      line[key] = n;
      return true;
    }
    if ((m = /^inset(?:-([xy]))?-(.+)$/.exec(tok))) {
      const o = offset(m[2]);
      if (!o) return false;
      const sides = m[1] === 'x' ? ['left', 'right'] : m[1] === 'y' ? ['top', 'bottom'] : ['top', 'right', 'bottom', 'left'];
      for (const side of sides as ('top' | 'left' | 'right' | 'bottom')[]) {
        style[side] = o.px;
        if (o.pct) (style.insetPct ??= {})[side] = o.pct;
      }
      return true;
    }
    if ((m = /^max-w-(.+)$/.exec(tok))) {
      const n = m[1] in MAX_W ? MAX_W[m[1]] : length(m[1]);
      if (n === null) return false;
      style.maxWidth = n; return true;
    }
    if ((m = /^(top|left|right|bottom)-(.+)$/.exec(tok))) {
      const o = offset(m[2]);
      if (!o) return false;
      const side = m[1] as 'top' | 'left' | 'right' | 'bottom';
      style[side] = o.px;
      if (o.pct) (style.insetPct ??= {})[side] = o.pct;
      return true;
    }
    if ((m = /^translate-([xy])-(.+)$/.exec(tok))) {
      const o = offset(m[2]);
      if (!o) return false;
      const t = (style.translate ??= { x: 0, y: 0, xPct: 0, yPct: 0 });
      if (m[1] === 'x') { t.x = o.px; t.xPct = o.pct; } else { t.y = o.px; t.yPct = o.pct; }
      return true;
    }

    // radius
    if ((m = /^rounded(?:-(t|r|b|l|tl|tr|br|bl))?(?:-(none|xs|sm|md|lg|xl|2xl|3xl|full))?$/.exec(tok)) && tok !== 'rounded') {
      const r = RADII[m[2] ?? 'DEFAULT'];
      const idx: Record<string, number[]> = {
        '': [0, 1, 2, 3], t: [0, 1], r: [1, 2], b: [2, 3], l: [3, 0], tl: [0], tr: [1], br: [2], bl: [3],
      };
      for (const i of idx[m[1] ?? '']) corners[i] = r;
      radiusSet = true;
      return true;
    }
    if ((m = /^rounded(?:-(t|r|b|l|tl|tr|br|bl))?-\[(.+)\]$/.exec(tok))) {
      const pct = /^(\d*\.?\d+)%$/.exec(m[2]);
      const n = pct ? (parseFloat(pct[1]) >= 50 ? 9999 : null) : arbLength(`[${m[2]}]`);
      if (n === null) return false;
      const idx: Record<string, number[]> = {
        '': [0, 1, 2, 3], t: [0, 1], r: [1, 2], b: [2, 3], l: [3, 0], tl: [0], tr: [1], br: [2], bl: [3],
      };
      for (const i of idx[m[1] ?? '']) corners[i] = n;
      radiusSet = true;
      return true;
    }

    // shadow
    if ((m = /^shadow-(sm|md|lg|xl|2xl|none)$/.exec(tok))) return applyShadow(m[1]);

    if ((m = /^shadow-\[(.+)\]$/.exec(tok))) return arbitraryProperty('box-shadow', m[1].replace(/_/g, ' '));
    if ((m = /^filter-\[(.+)\]$/.exec(tok))) return arbitraryProperty('filter', m[1].replace(/_/g, ' '));

    // rotation
    if ((m = /^rotate-(\d*\.?\d+)$/.exec(tok))) { style.rotation = (neg ? -1 : 1) * parseFloat(m[1]); return true; }
    if ((m = /^rotate-\[(-?\d*\.?\d+)deg\]$/.exec(tok))) { style.rotation = (neg ? -1 : 1) * parseFloat(m[1]); return true; }

    // gradients (v3 bg-gradient-to-*, v4 bg-linear-*)
    if ((m = /^bg-(?:gradient|linear)-to-(t|tr|r|br|b|bl|l|tl)$/.exec(tok))) { gradAngle = GRADIENT_DIRS[m[1]]; return true; }
    if ((m = /^bg-linear-(\d+)$/.exec(tok))) { gradAngle = Number(m[1]); return true; }
    if ((m = /^(from|via|to)-(.+)$/.exec(tok))) {
      const c = colorValue(m[2]);
      if (!c) return /^(from|via|to)-\d+%$/.test(tok); // stop positions: accepted, not modelled
      if (m[1] === 'from') gradFrom = c; else if (m[1] === 'via') gradVia = c; else gradTo = c;
      return true;
    }
    if ((m = /^bg-\[(.*gradient\(.*)\]$/.exec(tok))) {
      const g = parseLinearGradient(m[1].replace(/_/g, ' '));
      if (!g) return false;
      style.gradient = g; return true;
    }

    // opacity
    if ((m = /^opacity-(\d+)$/.exec(tok))) { style.opacity = Math.min(100, Number(m[1])) / 100; return true; }

    // background
    if ((m = /^bg-(.+)$/.exec(tok))) {
      const c = colorValue(m[1]);
      if (!c) return false;
      style.background = c; return true;
    }

    // border
    if ((m = /^border-(0|2|4|8)$/.exec(tok))) { borderWidth = Number(m[1]); return true; }
    if ((m = /^border-(.+)$/.exec(tok))) {
      const w = arbLength(m[1]);
      if (w !== null) { borderWidth = w; return true; }
      const c = colorValue(m[1]);
      if (!c) return false;
      borderColor = c; return true;
    }

    // text-*
    if ((m = /^text-(.+)$/.exec(tok))) {
      let v = m[1];
      // v4 font-size/line-height shorthand: text-sm/6, text-[34px]/10.5
      const slash = lastTop(v, '/');
      if (slash >= 0) {
        const size = v.slice(0, slash);
        const lh = v.slice(slash + 1);
        if (size in TEXT_SIZES || arbLength(size) !== null) {
          const lhPx = lh in LEADING ? null : length(lh);
          if (lhPx === null && !(lh in LEADING)) return false;
          v = size;
          const fs = size in TEXT_SIZES ? TEXT_SIZES[size][0] : arbLength(size)!;
          style.fontSize = fs;
          defaultLineHeight = undefined;
          leading = lh in LEADING ? { mult: LEADING[lh] } : { px: lhPx! };
          return true;
        }
      }
      if (v in TEXT_SIZES) {
        style.fontSize = TEXT_SIZES[v][0];
        defaultLineHeight = TEXT_SIZES[v][1];
        return true;
      }
      if (v === 'left' || v === 'center' || v === 'right' || v === 'justify') { style.textAlign = v; return true; }
      const n = arbLength(v);
      if (n !== null) { style.fontSize = n; defaultLineHeight = undefined; return true; }
      const c = colorValue(v);
      if (!c) return false;
      style.color = c; return true;
    }

    // font-*
    if ((m = /^font-(.+)$/.exec(tok))) {
      if (m[1] in FONT_WEIGHTS) { style.fontWeight = FONT_WEIGHTS[m[1]]; return true; }
      if (m[1] in FONT_FAMILIES) { style.fontFamily = FONT_FAMILIES[m[1]]; style.fontFallbacks = []; return true; }
      const arb = /^\[(.+)\]$/.exec(m[1]);
      if (!arb) return false;
      if (/^\d+$/.test(arb[1])) { style.fontWeight = Number(arb[1]); return true; }
      const stack = parseFontStack(arb[1].replace(/^(family-name|generic-name):/, '').replace(/_/g, ' '));
      if (!stack.length) return false;
      style.fontFamily = stack[0];
      style.fontFallbacks = stack.slice(1);
      return true;
    }
    if ((m = /^leading-(.+)$/.exec(tok))) {
      if (m[1] in LEADING) { leading = { mult: LEADING[m[1]] }; return true; }
      const pct = /^\[(\d*\.?\d+)%\]$/.exec(m[1]);
      if (pct) { leading = { mult: parseFloat(pct[1]) / 100 }; return true; }
      const n = length(m[1]);
      if (n === null) return false;
      leading = { px: n }; return true;
    }
    if ((m = /^tracking-(.+)$/.exec(tok))) {
      if (m[1] in TRACKING) { tracking = (neg ? -1 : 1) * TRACKING[m[1]]; trackingPx = undefined; return true; }
      const arb = /^\[(-?\d*\.?\d+)(em|px|rem)?\]$/.exec(m[1]);
      if (!arb) return false;
      const n = (neg ? -1 : 1) * parseFloat(arb[1]);
      if (arb[2] === 'em') { tracking = n; trackingPx = undefined; } else { trackingPx = n * (arb[2] === 'rem' ? 16 : 1); tracking = undefined; }
      return true;
    }
    return false;
  }

  function applyShadow(key: string): boolean {
    const s = SHADOWS[key];
    if (s === null) delete style.shadows;
    else style.shadows = [{ ...s, color: { ...s.color } }];
    return true;
  }

  function arbitraryProperty(prop: string, value: string): boolean {
    const camel = prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    if (camel === 'borderWidth') {
      const n = arbLength(`[${value}]`);
      if (n === null) return false;
      borderWidth = n; return true;
    }
    if (camel === 'borderColor') {
      const c = parseCssColor(value);
      if (!c) return false;
      borderColor = c; return true;
    }
    const r = inlineToStyle({ [camel]: value });
    if (r.unsupported.length) return false;
    Object.assign(style, r.style);
    return true;
  }

  // resolve deferred values
  const dir = style.direction ?? 'row';
  if (gap !== undefined) style.gap = gap;
  if (dir === 'row' && gapX !== undefined) style.gap = gapX;
  if (dir === 'column' && gapY !== undefined) style.gap = gapY;
  if (style.display === 'grid') {
    style.grid = { cols: tracks.cols ?? [], rows: tracks.rows ?? [] };
    if (gapX ?? gap) style.grid.colGap = gapX ?? gap;
    if (gapY ?? gap) style.grid.rowGap = gapY ?? gap;
  }
  if (Object.keys(line).length) {
    const span = (start?: number, end?: number, n?: number) =>
      n ?? (start !== undefined && end !== undefined && end > start ? end - start : undefined);
    const it: NonNullable<NormalizedStyle['gridItem']> = {};
    if (line.colStart !== undefined) it.colStart = line.colStart;
    const cs = line.colEnd === -1 ? -1 : span(line.colStart, line.colEnd, line.colSpan);
    if (cs !== undefined) it.colSpan = cs;
    if (line.rowStart !== undefined) it.rowStart = line.rowStart;
    const rs = line.rowEnd === -1 ? -1 : span(line.rowStart, line.rowEnd, line.rowSpan);
    if (rs !== undefined) it.rowSpan = rs;
    if (Object.keys(it).length) style.gridItem = it;
  }
  if (Object.keys(pad).length) {
    style.padding = { top: pad.top ?? 0, right: pad.right ?? 0, bottom: pad.bottom ?? 0, left: pad.left ?? 0 };
  }
  if (radiusSet) {
    style.radius = corners.every((c) => c === corners[0]) ? corners[0] : [...corners];
  }
  if (borderWidth !== undefined && borderWidth > 0) {
    style.border = { width: borderWidth, color: borderColor ?? DEFAULT_BORDER_COLOR };
  }
  const fs = style.fontSize ?? 16;
  if (leading) style.lineHeight = 'mult' in leading ? leading.mult * fs : leading.px;
  else if (defaultLineHeight !== undefined) style.lineHeight = defaultLineHeight;
  if (tracking !== undefined) style.letterSpacing = tracking * fs;
  else if (trackingPx !== undefined) style.letterSpacing = trackingPx;
  if (gradFrom || gradTo) {
    const clear = (c: RGBA): RGBA => withAlpha(c, 0);
    const from = gradFrom ?? clear(gradTo!);
    const to = gradTo ?? clear(gradVia ?? from);
    const stops = [{ position: 0, color: from }];
    if (gradVia) stops.push({ position: 0.5, color: gradVia });
    stops.push({ position: 1, color: to });
    style.gradient = { angle: gradAngle ?? 180, stops };
  }

  return { style, unsupported };
}
