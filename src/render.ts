import type { Gradient, IRNode, NormalizedStyle, RGBA, Sizing } from './types';

/** Warnings collected during the most recent render() call (array is cleared at the start of each call). */
export const renderWarnings: string[] = [];

const WEIGHT_NAMES: Record<number, string> = {
  100: 'Thin',
  200: 'Extra Light',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'Semi Bold',
  700: 'Bold',
  800: 'Extra Bold',
  900: 'Black',
};

const DEFAULT_FAMILY = 'Inter';
const fontCache = new Map<string, FontName>();
let count = 0;

function fontStyleName(weight: number | undefined, italic: boolean): string {
  const w = Math.min(900, Math.max(100, Math.round((weight ?? 400) / 100) * 100));
  const base = WEIGHT_NAMES[w] || 'Regular';
  if (!italic) return base;
  return w === 400 ? 'Italic' : base + ' Italic';
}

function wantedFont(style: NormalizedStyle): FontName {
  return {
    family: style.fontFamily || DEFAULT_FAMILY,
    style: fontStyleName(style.fontWeight, style.fontStyle === 'italic'),
  };
}

function fontKey(f: FontName): string {
  return f.family + '|' + f.style;
}

async function tryLoad(f: FontName): Promise<boolean> {
  try {
    await figma.loadFontAsync(f);
    return true;
  } catch (e) {
    return false;
  }
}

async function resolveFont(f: FontName): Promise<FontName> {
  const key = fontKey(f);
  const cached = fontCache.get(key);
  if (cached) return cached;
  let result: FontName | null = null;
  if (await tryLoad(f)) result = f;
  else {
    const inter = { family: DEFAULT_FAMILY, style: f.style };
    if (await tryLoad(inter)) result = inter;
    else {
      const reg = { family: DEFAULT_FAMILY, style: 'Regular' };
      if (await tryLoad(reg)) result = reg;
    }
    if (result) {
      renderWarnings.push('Font "' + f.family + ' ' + f.style + '" unavailable; used "' + result.family + ' ' + result.style + '".');
    }
  }
  if (!result) throw new Error('Could not load any font (tried ' + f.family + ' ' + f.style + ' and Inter).');
  fontCache.set(key, result);
  return result;
}

function collectFonts(node: IRNode, out: Map<string, FontName>): void {
  if (node.style.display === 'none') return;
  if (node.kind === 'text') {
    for (const st of [node.style, ...(node.spans || []).map((sp) => sp.style)]) {
      const f = wantedFont(st);
      out.set(fontKey(f), f);
    }
  } else if (node.kind === 'frame') {
    for (const c of node.children) collectFonts(c, out);
  }
}

function solid(c: RGBA): SolidPaint {
  return { type: 'SOLID', color: { r: c.r, g: c.g, b: c.b }, opacity: c.a };
}

/** CSS linear-gradient → Figma paint. The gradient line follows CSS: through the centre, long enough to reach the corners. */
function linearGradient(g: Gradient, w: number, h: number): GradientPaint {
  const rad = (g.angle * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const len = Math.abs(w * dx) + Math.abs(h * dy) || 1;
  const cx = w / 2;
  const cy = h / 2;
  const sx = cx - (len / 2) * dx;
  const sy = cy - (len / 2) * dy;
  // Maps the node's unit square to gradient space, where the gradient runs from x=0 to x=1.
  const t: Transform = [
    [(w * dx) / len, (h * dy) / len, -(sx * dx + sy * dy) / len],
    [(-w * dy) / len, (h * dx) / len, 0.5 - (-cx * dy + cy * dx) / len],
  ];
  return {
    type: 'GRADIENT_LINEAR',
    gradientTransform: t,
    gradientStops: g.stops.map((st) => ({ position: st.position, color: { r: st.color.r, g: st.color.g, b: st.color.b, a: st.color.a } })),
  };
}

/** CSS rotate (clockwise). Figma rotates around the top-left corner, so re-centre unless origin is top-left. */
function applyRotation(node: SceneNode, s: NormalizedStyle, absolute: boolean): void {
  if (!s.rotation || !('rotation' in node)) return;
  const w = node.width;
  const h = node.height;
  const x = node.x;
  const y = node.y;
  node.rotation = -s.rotation;
  if (!absolute || s.transformOrigin === 'top-left') return;
  const rad = (s.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // Top-left corner after rotating the box about its centre (y axis points down).
  node.x = x + w / 2 + (-w / 2) * cos - (-h / 2) * sin;
  node.y = y + h / 2 + (-w / 2) * sin + (-h / 2) * cos;
}

function applyBox(node: FrameNode | RectangleNode, s: NormalizedStyle): void {
  if (s.radius !== undefined) {
    if (typeof s.radius === 'number') node.cornerRadius = s.radius;
    else {
      node.topLeftRadius = s.radius[0];
      node.topRightRadius = s.radius[1];
      node.bottomRightRadius = s.radius[2];
      node.bottomLeftRadius = s.radius[3];
    }
  }
  if (s.border && s.border.width > 0) {
    node.strokes = [solid(s.border.color)];
    node.strokeWeight = s.border.width;
    node.strokeAlign = 'INSIDE';
  }
  if (s.shadows && s.shadows.length) {
    node.effects = s.shadows.map(
      (sh): DropShadowEffect => ({
        type: 'DROP_SHADOW',
        color: { r: sh.color.r, g: sh.color.g, b: sh.color.b, a: sh.color.a },
        offset: { x: sh.x, y: sh.y },
        radius: sh.blur,
        spread: sh.spread,
        visible: true,
        blendMode: 'NORMAL',
      })
    );
  }
  if (s.opacity !== undefined) node.opacity = s.opacity;
}

/** Apply a styled range (e.g. <b> inside <p>) on top of the text node's base style. */
async function applySpan(t: TextNode, start: number, end: number, sp: NormalizedStyle, base: NormalizedStyle): Promise<void> {
  if (end <= start || end > t.characters.length) return;
  t.setRangeFontName(start, end, await resolveFont(wantedFont(sp)));
  if (sp.fontSize !== undefined && sp.fontSize !== base.fontSize) t.setRangeFontSize(start, end, sp.fontSize);
  if (sp.color) t.setRangeFills(start, end, [solid(sp.color)]);
  if (sp.letterSpacing !== undefined) t.setRangeLetterSpacing(start, end, { unit: 'PIXELS', value: sp.letterSpacing });
  if (sp.textDecoration !== base.textDecoration) {
    t.setRangeTextDecoration(start, end,
      sp.textDecoration === 'underline' ? 'UNDERLINE' : sp.textDecoration === 'line-through' ? 'STRIKETHROUGH' : 'NONE');
  }
  if (sp.textTransform !== base.textTransform) {
    t.setRangeTextCase(start, end, sp.textTransform === 'upper' ? 'UPPER' : sp.textTransform === 'lower' ? 'LOWER' : 'ORIGINAL');
  }
}

interface ParentCtx {
  frame: FrameNode;
  style: NormalizedStyle;
}

function safe(fn: () => void): void {
  try {
    fn();
  } catch (e) {
    /* property not supported in this context; ignore */
  }
}

function setSizing(
  node: SceneNode & LayoutMixin,
  s: NormalizedStyle,
  parent: ParentCtx | null,
  absolute: boolean,
  defaults: { h: Sizing; v: Sizing }
): void {
  const inAuto = !!parent && !absolute;
  const resolve = (sz: Sizing | undefined, dim: number | undefined, def: Sizing): Sizing => {
    let r: Sizing = sz ?? (dim !== undefined ? 'FIXED' : def);
    if (r === 'FILL' && !inAuto) r = dim !== undefined ? 'FIXED' : def === 'FILL' ? 'HUG' : def;
    return r;
  };
  const h = resolve(s.widthSizing, s.width, defaults.h);
  const v = resolve(s.heightSizing, s.height, defaults.v);
  // Resize first (resize switches axes to FIXED), then apply the real sizing modes.
  if ((h === 'FIXED' && s.width !== undefined) || (v === 'FIXED' && s.height !== undefined)) {
    node.resize(
      h === 'FIXED' && s.width !== undefined ? Math.max(0.01, s.width) : node.width,
      v === 'FIXED' && s.height !== undefined ? Math.max(0.01, s.height) : node.height
    );
  }
  const stretchH = inAuto && parent!.style.direction === 'column' && parent!.style.align === 'stretch' && h !== 'FIXED';
  const stretchV = inAuto && parent!.style.direction !== 'column' && parent!.style.display !== 'block' && parent!.style.align === 'stretch' && v !== 'FIXED';
  if (stretchH || stretchV) safe(() => { node.layoutAlign = 'STRETCH'; });
  safe(() => { node.layoutSizingHorizontal = stretchH ? 'FILL' : h; });
  safe(() => { node.layoutSizingVertical = stretchV ? 'FILL' : v; });
}

async function build(ir: IRNode, parent: ParentCtx | null): Promise<SceneNode | null> {
  const s = ir.style;
  if (s.display === 'none') return null;
  const absolute = !!parent && s.position === 'absolute';

  let node: SceneNode;

  if (ir.kind === 'frame') {
    const f = figma.createFrame();
    node = f;
    count++;
    f.name = ir.name;
    f.fills = s.background ? [solid(s.background)] : [];
    f.clipsContent = s.overflowHidden ?? false;
    f.layoutMode = s.direction === 'row' ? 'HORIZONTAL' : 'VERTICAL';
    if (s.justify === 'between') {
      f.primaryAxisAlignItems = 'SPACE_BETWEEN';
    } else {
      f.itemSpacing = s.gap ?? 0;
      f.primaryAxisAlignItems = s.justify === 'center' ? 'CENTER' : s.justify === 'end' ? 'MAX' : 'MIN';
    }
    if (s.padding) {
      f.paddingTop = s.padding.top;
      f.paddingRight = s.padding.right;
      f.paddingBottom = s.padding.bottom;
      f.paddingLeft = s.padding.left;
    }
    const isRow = f.layoutMode === 'HORIZONTAL';
    f.counterAxisAlignItems =
      s.align === 'center' ? 'CENTER' : s.align === 'end' ? 'MAX' : s.align === 'baseline' && isRow ? 'BASELINE' : 'MIN';
    if (s.wrap && isRow) {
      f.layoutWrap = 'WRAP';
      safe(() => { f.counterAxisSpacing = s.gap ?? 0; });
    }
    applyBox(f, s);
  } else if (ir.kind === 'text') {
    const t = figma.createText();
    node = t;
    count++;
    t.name = ir.name;
    t.fontName = await resolveFont(wantedFont(s));
    t.characters = ir.text;
    t.fontSize = s.fontSize ?? 14;
    t.lineHeight =
      typeof s.lineHeight === 'number' ? { unit: 'PIXELS', value: s.lineHeight } : { unit: 'AUTO' };
    if (s.letterSpacing !== undefined) t.letterSpacing = { unit: 'PIXELS', value: s.letterSpacing };
    if (s.textAlign) {
      t.textAlignHorizontal = s.textAlign === 'center' ? 'CENTER' : s.textAlign === 'right' ? 'RIGHT' : s.textAlign === 'justify' ? 'JUSTIFIED' : 'LEFT';
    }
    t.textCase = s.textTransform === 'upper' ? 'UPPER' : s.textTransform === 'lower' ? 'LOWER' : 'ORIGINAL';
    t.textDecoration = s.textDecoration === 'underline' ? 'UNDERLINE' : s.textDecoration === 'line-through' ? 'STRIKETHROUGH' : 'NONE';
    t.fills = [solid(s.color || { r: 0, g: 0, b: 0, a: 1 })];
    if (s.opacity !== undefined) t.opacity = s.opacity;
    for (const sp of ir.spans || []) await applySpan(t, sp.start, sp.end, sp.style, s);
  } else if (ir.kind === 'image') {
    const r = figma.createRectangle();
    node = r;
    count++;
    r.name = ir.name;
    r.resize(s.width ?? 120, s.height ?? 80);
    r.fills = [solid({ r: 0xe5 / 255, g: 0xe7 / 255, b: 0xeb / 255, a: 1 })];
    applyBox(r, s);
  } else {
    let created: SceneNode | null = null;
    try {
      created = figma.createNodeFromSvg(ir.svg);
    } catch (e) {
      renderWarnings.push('SVG "' + ir.name + '" could not be parsed; used a placeholder.');
    }
    if (!created) {
      const r = figma.createRectangle();
      r.resize(s.width ?? 24, s.height ?? 24);
      r.fills = [solid({ r: 0xe5 / 255, g: 0xe7 / 255, b: 0xeb / 255, a: 1 })];
      created = r;
    }
    node = created;
    count++;
    node.name = ir.name;
    if ('opacity' in node && s.opacity !== undefined) (node as BlendMixin).opacity = s.opacity;
  }

  if (parent) parent.frame.appendChild(node);

  if (absolute) {
    safe(() => { (node as FrameNode).layoutPositioning = 'ABSOLUTE'; });
  }

  // Sizing
  if (ir.kind === 'text') {
    const t = node as TextNode;
    const parentWide =
      !!parent && parent.style.direction === 'column' || (!!parent && parent.style.direction === undefined);
    const parentFixedW = !!parent && (parent.style.widthSizing === 'FILL' || parent.style.widthSizing === 'FIXED' || parent.style.width !== undefined);
    const fill = !absolute && !!parent && (s.widthSizing === 'FILL' || (s.widthSizing === undefined && s.width === undefined && parentWide && parentFixedW));
    if (fill) {
      t.textAutoResize = 'HEIGHT';
      safe(() => { t.layoutSizingHorizontal = 'FILL'; });
      if (s.heightSizing === 'FIXED' && s.height !== undefined) {
        t.textAutoResize = 'NONE';
        safe(() => { t.layoutSizingHorizontal = 'FILL'; });
        t.resize(t.width, s.height);
      }
    } else if (s.width !== undefined || s.widthSizing === 'FIXED') {
      t.textAutoResize = 'HEIGHT';
      if (s.width !== undefined) t.resize(Math.max(0.01, s.width), t.height);
      if (s.height !== undefined && s.heightSizing === 'FIXED') {
        t.textAutoResize = 'NONE';
        t.resize(t.width, s.height);
      }
    } else {
      t.textAutoResize = 'WIDTH_AND_HEIGHT';
    }
    if (s.maxWidth !== undefined && !fill) {
      if (t.width > s.maxWidth) {
        t.textAutoResize = 'HEIGHT';
        t.resize(s.maxWidth, t.height);
      }
    }
  } else if (ir.kind === 'frame') {
    setSizing(node as FrameNode, s, parent, absolute, { h: 'HUG', v: 'HUG' });
    const f = node as FrameNode;
    if (s.minWidth !== undefined) safe(() => { f.minWidth = s.minWidth!; });
    if (s.maxWidth !== undefined) safe(() => { f.maxWidth = s.maxWidth!; });
  } else {
    setSizing(node as FrameNode, s, parent, absolute, { h: 'FIXED', v: 'FIXED' });
  }

  if (absolute) {
    node.x = s.left ?? 0;
    node.y = s.top ?? 0;
  }

  if (ir.kind === 'frame') {
    const ctx: ParentCtx = { frame: node as FrameNode, style: s };
    for (const child of ir.children) await build(child, ctx);
  }

  // Both need the final size, so they run once children have been laid out.
  if (s.gradient && (ir.kind === 'frame' || ir.kind === 'image')) {
    const f = node as FrameNode | RectangleNode;
    const base = s.background ? [solid(s.background)] : [];
    f.fills = [...base, linearGradient(s.gradient, f.width, f.height)];
  }
  applyRotation(node, s, absolute);

  return node;
}

export async function render(root: IRNode): Promise<{ node: SceneNode; count: number }> {
  renderWarnings.length = 0;
  count = 0;

  const fonts = new Map<string, FontName>();
  collectFonts(root, fonts);
  const keys = Array.from(fonts.keys());
  for (const k of keys) await resolveFont(fonts.get(k)!);

  // Text creation resolves fonts through the same cache keyed by requested font.
  const node = await build(root, null);
  if (!node) throw new Error('Root element has display:none; nothing to render.');
  return { node, count };
}
