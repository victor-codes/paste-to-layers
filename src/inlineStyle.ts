import type { Gradient, GridTrack, NormalizedStyle, RGBA, Sizing } from './types';
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

/** Properties with no visual effect in Figma (rendering hints, box model, wrapping, interaction). */
const IGNORED = new Set([
  'boxSizing', 'fontSynthesis', 'WebkitFontSmoothing', 'MozOsxFontSmoothing', 'textRendering',
  'fontFeatureSettings', 'fontOpticalSizing', 'overflowWrap', 'wordBreak', 'wordWrap', 'hyphens',
  'flexShrink', 'cursor', 'userSelect', 'pointerEvents', 'WebkitTapHighlightColor',
  'transition', 'transitionProperty', 'transitionDuration', 'transitionTimingFunction', 'willChange',
  'outline', 'listStyle', 'textSizeAdjust', 'WebkitTextSizeAdjust', 'borderStyle', 'contain', 'isolation',
  'zIndex', 'fontVariationSettings', 'alignContent', 'textUnderlinePosition', 'textUnderlineOffset',
  'backgroundSize', 'backgroundPosition', 'backgroundRepeat', 'objectFit', 'objectPosition',
]);

const ANGLE_UNITS: Record<string, number> = { deg: 1, grad: 0.9, rad: 180 / Math.PI, turn: 360 };
const SIDE_ANGLES: Record<string, number> = {
  top: 0, 'top right': 45, right: 90, 'bottom right': 135, bottom: 180, 'bottom left': 225, left: 270, 'top left': 315,
};

function parseAngle(s: string): number | null {
  const m = /^(-?\d*\.?\d+)(deg|grad|rad|turn)$/.exec(s.trim());
  return m ? parseFloat(m[1]) * ANGLE_UNITS[m[2]] : null;
}

/** Parse `linear-gradient(...)` (CSS syntax, including `in <colorspace>` hints). */
export function parseLinearGradient(s: string): Gradient | null {
  const m = /^(?:repeating-)?linear-gradient\((.*)\)$/i.exec(s.trim());
  if (!m) return null;
  const args = splitTop(m[1], /,/).map((a) => a.trim());
  let angle = 180;
  const head = args[0]?.replace(/\bin\s+[a-z-]+(\s+(shorter|longer|increasing|decreasing)\s+hue)?/gi, '').trim() ?? '';
  if (/^to\s/.test(head)) {
    const side = head.slice(3).trim().split(/\s+/).sort((a, b) => (a === 'top' || a === 'bottom' ? -1 : b === 'top' || b === 'bottom' ? 1 : 0)).join(' ');
    if (!(side in SIDE_ANGLES)) return null;
    angle = SIDE_ANGLES[side];
    args.shift();
  } else if (parseAngle(head) !== null) {
    angle = parseAngle(head)!;
    args.shift();
  } else if (head === '') {
    args.shift();
  }
  const raw: { color: RGBA; position?: number }[] = [];
  for (const a of args) {
    const parts = splitTop(a);
    const color = parseCssColor(parts[0] ?? '');
    if (!color) return null;
    const positions = parts.slice(1).map((p) => /^-?\d*\.?\d+%$/.test(p) ? parseFloat(p) / 100 : NaN);
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
  return {
    angle,
    stops: raw.map((r) => ({ position: Math.min(1, Math.max(0, r.position!)), color: r.color })),
  };
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

function toKebabless(k: string): string {
  return k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

export function inlineToStyle(obj: Record<string, string | number>): { style: NormalizedStyle; unsupported: string[] } {
  const style: NormalizedStyle = {};
  const unsupported: string[] = [];
  const raw: Record<string, string | number> = {};
  for (const k of Object.keys(obj)) raw[toKebabless(k)] = obj[k];

  let fontSize = 16;
  let borderWidth: number | undefined;
  let borderColor: RGBA | undefined;
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
        // drop-shadow() layers become shadows; other filters have no Figma equivalent.
        const shadows: NonNullable<NormalizedStyle['shadows']> = [];
        let bad = false;
        for (const fn of splitTop(sv)) {
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
            if (url) { style.imageUrl ??= url[2]; ok = true; continue; }
            if (/^linear-gradient\(/.test(l) && !style.gradient) {
              const g = parseLinearGradient(l);
              if (g) { style.gradient = g; ok = true; }
            }
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
      case 'border': {
        if (sv === 'none' || sv === '0') break;
        let width: number | undefined;
        let col: RGBA | undefined;
        let bad = false;
        for (const p of splitTop(sv)) {
          const l = parseLen(p);
          if (l && 'px' in l) { width = l.px; continue; }
          if (/^(solid|none)$/.test(p)) continue;
          if (/^(dashed|dotted|double|groove|ridge|inset|outset)$/.test(p)) continue;
          const c = parseCssColor(p);
          if (c) col = c; else bad = true;
        }
        if (bad || width === undefined) { unsupported.push(key); break; }
        style.border = { width, color: col ?? { r: 0, g: 0, b: 0, a: 1 } };
        break;
      }
      case 'boxShadow': {
        if (sv === 'none') break;
        const shadows: NonNullable<NormalizedStyle['shadows']> = [];
        let bad = false;
        for (const layer of splitTop(sv, /,/)) {
          const parts = splitTop(layer);
          if (parts.includes('inset')) { bad = true; continue; }
          const nums: number[] = [];
          let col: RGBA | undefined;
          for (const p of parts) {
            const l = parseLen(p);
            if (l && 'px' in l) nums.push(l.px);
            else { const c = parseCssColor(p); if (c) col = c; }
          }
          if (nums.length < 2 || nums.length > 4) { bad = true; continue; }
          shadows.push({
            x: nums[0], y: nums[1], blur: nums[2] ?? 0, spread: nums[3] ?? 0,
            color: col ?? { r: 0, g: 0, b: 0, a: 1 },
          });
        }
        if (bad) unsupported.push(key);
        if (shadows.length) style.shadows = shadows;
        break;
      }
      case 'borderWidth': {
        const n = px(key, v);
        if (n !== undefined) borderWidth = n;
        break;
      }
      case 'borderColor': { const c = color(key, v); if (c) borderColor = c; break; }
      case 'rotate': {
        const a = parseAngle(sv);
        if (a !== null) style.rotation = a; else if (sv !== 'none') unsupported.push(key);
        break;
      }
      case 'transform': {
        if (sv === 'none') break;
        let ok = true;
        for (const fn of splitTop(sv)) {
          const m = /^(rotate|translate|translateX|translateY)\((.*)\)$/.exec(fn);
          const args = m ? splitTop(m[2], /,/).map((a) => a.trim()) : [];
          if (m && m[1] === 'rotate' && parseAngle(args[0] ?? '') !== null) { style.rotation = parseAngle(args[0])!; continue; }
          const t = !m ? null
            : m[1] === 'translate' ? parseTranslate(args[0] ?? '', args[1])
            : m[1] === 'translateX' ? parseTranslate(args[0] ?? '') : parseTranslate('0', args[0] ?? '');
          if (t) style.translate = t; else ok = false;
        }
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
  if (borderWidth !== undefined || borderColor !== undefined) {
    const width = borderWidth ?? style.border?.width ?? 0;
    if (width > 0) style.border = { width, color: borderColor ?? style.border?.color ?? { r: 0, g: 0, b: 0, a: 1 } };
  }
  return { style, unsupported };
}
