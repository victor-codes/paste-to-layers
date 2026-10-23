import type { Gradient, GridTrack, IRNode, NormalizedStyle, RGBA, Sizing } from './types';

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
    // The whole stack travels in `family` so the cache key covers fallbacks; resolveFont splits it.
    family: [style.fontFamily || DEFAULT_FAMILY, ...(style.fontFallbacks || [])].join(', '),
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

// Longer names first so "extralight" isn't read as "light".
const STYLE_WEIGHTS: [RegExp, number][] = [
  [/^(thin|hairline)$/, 100],
  [/^(extralight|ultralight)$/, 200],
  [/^light$/, 300],
  [/^(regular|normal|book|roman|)$/, 400],
  [/^medium$/, 500],
  [/^(semibold|demibold)$/, 600],
  [/^bold$/, 700],
  [/^(extrabold|ultrabold)$/, 800],
  [/^(black|heavy)$/, 900],
];

/** "Extra Bold Italic" / "ExtraBold" / "Extrabold" → { weight: 800, italic }; null for styles like "Condensed Bold". */
export function parseStyleName(style: string): { weight: number; italic: boolean } | null {
  let n = style.toLowerCase().replace(/[\s_-]+/g, '');
  const italic = /(italic|oblique)$/.test(n);
  n = n.replace(/(italic|oblique)$/, '');
  for (const [re, w] of STYLE_WEIGHTS) if (re.test(n)) return { weight: w, italic };
  return null;
}

let familyIndex: Map<string, { family: string; styles: string[] }> | null = null;

/** "Cooper BT" and "CooperBT" name the same family. */
const familyKey = (family: string) => family.toLowerCase().replace(/[\s_-]+/g, '');

/**
 * Installed family for a CSS name. Fonts name the same weight differently ("Semi Bold" vs "SemiBold"),
 * and CSS sometimes uses the PostScript name ("CooperBT-Medium"), so that's tried without its style suffix.
 */
async function familyInfo(family: string): Promise<{ family: string; styles: string[] } | null> {
  if (!familyIndex) {
    familyIndex = new Map();
    try {
      for (const f of await figma.listAvailableFontsAsync()) {
        const key = familyKey(f.fontName.family);
        let entry = familyIndex.get(key);
        if (!entry) familyIndex.set(key, (entry = { family: f.fontName.family, styles: [] }));
        entry.styles.push(f.fontName.style);
      }
    } catch (e) {
      /* fall back to loading the requested names directly */
    }
  }
  const dash = family.lastIndexOf('-');
  return familyIndex.get(familyKey(family)) ??
    (dash > 0 ? familyIndex.get(familyKey(family.slice(0, dash))) ?? null : null);
}

/** The family's style closest to the requested weight, preferring a matching italic. */
export function closestStyle(styles: string[], weight: number, italic: boolean): string | null {
  let best: string | null = null;
  let bestScore = Infinity;
  for (const st of styles) {
    const p = parseStyleName(st);
    if (!p) continue;
    // Like CSS, lean heavier for bold requests and lighter for light ones on ties.
    const tie = (p.weight > weight) === (weight >= 500) ? 0 : 1;
    const score = (p.italic === italic ? 0 : 10000) + Math.abs(p.weight - weight) * 2 + tie;
    if (score < bestScore) { bestScore = score; best = st; }
  }
  return best;
}

async function loadClosest(family: string, weight: number, italic: boolean): Promise<FontName | null> {
  const info = await familyInfo(family);
  if (!info) {
    const direct = { family, style: fontStyleName(weight, italic) };
    return (await tryLoad(direct)) ? direct : null;
  }
  const style = closestStyle(info.styles, weight, italic);
  const f = style ? { family: info.family, style } : null;
  return f && (await tryLoad(f)) ? f : null;
}

async function resolveFont(f: FontName): Promise<FontName> {
  const key = fontKey(f);
  const cached = fontCache.get(key);
  if (cached) return cached;
  const want = parseStyleName(f.style) ?? { weight: 400, italic: false };
  const stack = f.family.split(', ');
  let result: FontName | null = null;
  for (const family of stack) if (!result) result = await loadClosest(family, want.weight, want.italic);
  if (!result && !stack.includes(DEFAULT_FAMILY)) result = await loadClosest(DEFAULT_FAMILY, want.weight, want.italic);
  if (!result) {
    const reg = { family: DEFAULT_FAMILY, style: 'Regular' };
    if (await tryLoad(reg)) result = reg;
  }
  if (!result) throw new Error('Could not load any font (tried ' + f.family + ' ' + f.style + ' and Inter).');
  const got = parseStyleName(result.style);
  const fromStack = (await Promise.all(stack.map(familyInfo))).some((i) => i?.family === result!.family);
  if (!fromStack || !got || got.weight !== want.weight || got.italic !== want.italic) {
    renderWarnings.push('Font "' + stack[0] + ' ' + f.style + '" unavailable; used "' + result.family + ' ' + result.style + '".');
  }
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

const imageCache = new Map<string, Promise<string | null>>();

/** Image fill for a URL (cached per render); null when it can't be fetched or decoded. */
async function imagePaint(url: string, name: string): Promise<ImagePaint | null> {
  let hash = imageCache.get(url);
  if (!hash) {
    hash = figma.createImageAsync(url).then((img) => img.hash, () => null);
    imageCache.set(url, hash);
  }
  const h = await hash;
  if (!h) {
    renderWarnings.push('Image for "' + name + '" could not be loaded (' + url + '); used a placeholder.');
    return null;
  }
  return { type: 'IMAGE', imageHash: h, scaleMode: 'FILL' };
}

const PLACEHOLDER: RGBA = { r: 0xe5 / 255, g: 0xe7 / 255, b: 0xeb / 255, a: 1 };

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
    // Figma only accepts spread on frames that clip content and have a visible fill.
    if (node.type === 'FRAME' && s.shadows.some((sh) => sh.spread !== 0)) {
      if (s.background || s.gradient) node.clipsContent = true;
      else renderWarnings.push('Shadow spread on "' + node.name + '" needs a background in Figma; it may be ignored.');
    }
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
  // Whether the frame's size on each axis is known up front (fixed, or filled from a known size).
  definiteW: boolean;
  definiteH: boolean;
  grid?: Map<IRNode, GridCell>; // cells of in-flow children when the frame is a grid
}

/**
 * Which axes the parent stretches this child across. CSS stretches by default (`align-items: normal`,
 * block-level boxes in block flow); that's only mirrored when the parent's size is known, since a FILL
 * child can't size a hugging parent the way CSS shrink-to-fit does.
 */
function crossStretch(parent: ParentCtx, s: NormalizedStyle): { h: boolean; v: boolean } {
  const p = parent.style;
  // Grid items stretch over their cell unless sized or aligned.
  if (p.display === 'grid') return { h: true, v: s.alignSelf === undefined };
  const column = p.direction === 'column';
  if (p.align === 'stretch') return { h: column, v: !column && p.display !== 'block' };
  if (p.align !== undefined) return { h: false, v: false };
  if (p.display !== 'flex') return { h: column && !s.inline && parent.definiteW, v: false };
  return column ? { h: parent.definiteW, v: false } : { h: false, v: parent.definiteH };
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
): { h: Sizing; v: Sizing } {
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
  const st = inAuto ? crossStretch(parent!, s) : { h: false, v: false };
  const stretchH = st.h && h !== 'FIXED';
  const stretchV = st.v && v !== 'FIXED';
  if ((stretchH || stretchV) && parent!.style.display !== 'grid') safe(() => { node.layoutAlign = 'STRETCH'; });
  safe(() => { node.layoutSizingHorizontal = stretchH ? 'FILL' : h; });
  safe(() => { node.layoutSizingVertical = stretchV ? 'FILL' : v; });
  return { h: stretchH ? 'FILL' : h, v: stretchV ? 'FILL' : v };
}

async function build(ir: IRNode, parent: ParentCtx | null): Promise<SceneNode | null> {
  if (ir.style.display === 'none') return null;
  const absolute = !!parent && ir.style.position === 'absolute';
  const s = absolute ? stretchAbsolute(ir.style, parent!) : ir.style;

  let node: SceneNode;
  let sizing: { h: Sizing; v: Sizing } = { h: 'HUG', v: 'HUG' };
  let image: ImagePaint | null = null;
  let grid: Map<IRNode, GridCell> | undefined;

  if (ir.kind === 'frame') {
    const f = figma.createFrame();
    node = f;
    count++;
    f.name = ir.name;
    f.fills = s.background ? [solid(s.background)] : [];
    if (s.imageUrl) image = await imagePaint(s.imageUrl, ir.name);
    if (image) f.fills = [...f.fills, image];
    else if (s.imageUrl) f.fills = [...f.fills, solid(PLACEHOLDER)];
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
    if (ir.kind === 'frame' && s.display === 'grid') grid = setupGrid(f, s, ir.children);
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
    if (s.imageUrl) image = await imagePaint(s.imageUrl, ir.name);
    r.fills = [image ?? solid(PLACEHOLDER)];
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
    // Inline <svg> clips to its box unless `overflow: visible` (Paper strokes often sit outside the viewBox).
    if (node.type === 'FRAME') (node as FrameNode).clipsContent = s.overflowHidden ?? true;
    if ('opacity' in node && s.opacity !== undefined) (node as BlendMixin).opacity = s.opacity;
  }

  if (parent) appendTo(parent, node, parent.grid?.get(ir));
  if (parent?.grid && s.alignSelf) {
    const v = s.alignSelf === 'center' ? 'CENTER' : s.alignSelf === 'end' ? 'MAX' : 'MIN';
    safe(() => { (node as SceneNode & GridChildrenMixin).gridChildVerticalAlign = v; });
  }

  if (absolute) {
    safe(() => { (node as FrameNode).layoutPositioning = 'ABSOLUTE'; });
  }

  // Sizing
  if (ir.kind === 'text') {
    const t = node as TextNode;
    const inFlow = !absolute && !!parent;
    const stretched = inFlow && parent!.style.direction !== 'row' && parent!.definiteW && crossStretch(parent!, s).h;
    const fill = inFlow && (s.widthSizing === 'FILL' || (s.widthSizing === undefined && s.width === undefined && stretched));
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
    // Unstretched text (e.g. in an items-center column) still wraps at the parent's content width.
    if (inFlow && !fill && t.textAutoResize === 'WIDTH_AND_HEIGHT' && s.widthSizing !== 'HUG' &&
        parent!.definiteW && parent!.style.direction !== 'row') {
      const inner = parent!.frame.width - parent!.frame.paddingLeft - parent!.frame.paddingRight;
      if (inner > 0 && t.width > inner) {
        t.textAutoResize = 'HEIGHT';
        t.resize(inner, t.height);
      }
    }
  } else if (ir.kind === 'frame') {
    sizing = setSizing(node as FrameNode, s, parent, absolute, { h: 'HUG', v: 'HUG' });
    const f = node as FrameNode;
    if (s.minWidth !== undefined) safe(() => { f.minWidth = s.minWidth!; });
    if (s.maxWidth !== undefined) safe(() => { f.maxWidth = s.maxWidth!; });
    if (s.minHeight !== undefined) safe(() => { f.minHeight = s.minHeight!; });
    if (grid) sizeTracks(f, s, sizing);
  } else {
    setSizing(node as FrameNode, s, parent, absolute, { h: 'FIXED', v: 'FIXED' });
  }


  if (ir.kind === 'frame') {
    const definite = (mode: Sizing, parentDefinite: boolean | undefined) =>
      mode === 'FIXED' || (mode === 'FILL' && !!parentDefinite && !absolute);
    const ctx: ParentCtx = {
      frame: node as FrameNode,
      style: s,
      definiteW: definite(sizing.h, parent?.definiteW),
      definiteH: definite(sizing.v, parent?.definiteH),
      grid,
    };
    const f = node as FrameNode;
    const placed: [SceneNode, NormalizedStyle][] = [];
    for (const child of ir.children) {
      const n = await build(child, ctx);
      if (n && child.style.position === 'absolute') placed.push([n, child.style]);
    }
    if (placed.length && placed.length === f.children.length) fitToAbsolute(f, s, sizing, placed);
    // Insets like `calc(50% - 8px)` and `right` need the parent's final size.
    for (const [n, cs] of placed) placeAbsolute(n, cs, f);
  }

  // Both need the final size, so they run once children have been laid out.
  if (s.gradient && (ir.kind === 'frame' || ir.kind === 'image')) {
    const f = node as FrameNode | RectangleNode;
    const base: Paint[] = ir.kind === 'frame' && s.background ? [solid(s.background)] : [];
    if (image) base.push(image);
    f.fills = [...base, linearGradient(s.gradient, f.width, f.height)];
  }
  if (ir.kind === 'text' && s.textGradient) {
    const t = node as TextNode;
    t.fills = [linearGradient(s.textGradient, t.width, t.height)];
  }
  if (!absolute) applyRotation(node, s, false);

  return node;
}

/**
 * An absolute box with both insets on an axis and no size spans between them (`inset-x-0`,
 * `left-12 right-12`). Only resolved when the parent's size is known.
 */
function stretchAbsolute(s: NormalizedStyle, parent: ParentCtx): NormalizedStyle {
  const pct = s.insetPct || {};
  const out = { ...s };
  const span = (a: number | undefined, b: number | undefined, pa = 0, pb = 0, size: number) =>
    a !== undefined && b !== undefined ? size * (1 - pa - pb) - a - b : undefined;
  if (s.width === undefined && s.widthSizing !== 'HUG' && parent.definiteW) {
    let w = span(s.left, s.right, pct.left, pct.right, parent.frame.width);
    if (w !== undefined && s.maxWidth !== undefined) w = Math.min(w, s.maxWidth);
    if (w !== undefined) { out.width = Math.max(0, w); out.widthSizing = 'FIXED'; }
  }
  if (s.height === undefined && s.heightSizing !== 'HUG' && parent.definiteH) {
    const h = span(s.top, s.bottom, pct.top, pct.bottom, parent.frame.height);
    if (h !== undefined) { out.height = Math.max(0, h); out.heightSizing = 'FIXED'; }
  }
  return out;
}

/** 0-based grid cell of an item; spans are clamped to the column count. */
export interface GridCell { row: number; col: number; rowSpan: number; colSpan: number }

/**
 * CSS grid auto-placement, simplified: items with an explicit row and column go first, the rest
 * flow row by row from a cursor (sparse packing), honouring an explicit column if there is one.
 */
export function placeGridItems(items: NormalizedStyle['gridItem'][], cols: number): { cells: GridCell[]; rows: number } {
  const taken = new Set<string>();
  const fits = (r: number, c: number, rs: number, cs: number) => {
    if (c + cs > cols) return false;
    for (let i = r; i < r + rs; i++) for (let j = c; j < c + cs; j++) if (taken.has(i + ',' + j)) return false;
    return true;
  };
  const take = (cell: GridCell) => {
    for (let i = cell.row; i < cell.row + cell.rowSpan; i++)
      for (let j = cell.col; j < cell.col + cell.colSpan; j++) taken.add(i + ',' + j);
  };
  const spans = items.map((it) => {
    const col = it?.colStart !== undefined ? Math.min(Math.max(1, it.colStart), cols) - 1 : undefined;
    const cs = it?.colSpan === -1 ? cols - (col ?? 0) : Math.max(1, it?.colSpan ?? 1);
    return { col, row: it?.rowStart !== undefined ? Math.max(1, it.rowStart) - 1 : undefined,
      colSpan: Math.min(cs, cols - (col ?? 0)), rowSpan: Math.max(1, it?.rowSpan === -1 ? 1 : it?.rowSpan ?? 1) };
  });
  const cells: (GridCell | undefined)[] = items.map(() => undefined);
  spans.forEach((sp, i) => {
    if (sp.col === undefined || sp.row === undefined) return;
    cells[i] = { row: sp.row, col: sp.col, rowSpan: sp.rowSpan, colSpan: sp.colSpan };
    take(cells[i]!);
  });
  let curR = 0;
  let curC = 0;
  spans.forEach((sp, i) => {
    if (cells[i]) return;
    let cell: GridCell;
    if (sp.row !== undefined) {
      let c = 0;
      while (!fits(sp.row, c, sp.rowSpan, sp.colSpan) && c + sp.colSpan < cols) c++;
      cell = { row: sp.row, col: c, rowSpan: sp.rowSpan, colSpan: sp.colSpan };
    } else if (sp.col !== undefined) {
      if (sp.col < curC) curR++;
      while (!fits(curR, sp.col, sp.rowSpan, sp.colSpan)) curR++;
      cell = { row: curR, col: sp.col, rowSpan: sp.rowSpan, colSpan: sp.colSpan };
      curC = sp.col + sp.colSpan;
    } else {
      for (;;) {
        if (curC + sp.colSpan > cols) { curR++; curC = 0; }
        if (fits(curR, curC, sp.rowSpan, sp.colSpan)) break;
        curC++;
      }
      cell = { row: curR, col: curC, rowSpan: sp.rowSpan, colSpan: sp.colSpan };
      curC += sp.colSpan;
    }
    cells[i] = cell;
    take(cell);
  });
  const rows = Math.max(1, ...cells.map((c) => c!.row + c!.rowSpan));
  return { cells: cells as GridCell[], rows };
}

/** Switch a frame to Figma's grid layout and work out where each in-flow child goes. */
function setupGrid(f: FrameNode, s: NormalizedStyle, children: IRNode[]): Map<IRNode, GridCell> | undefined {
  const g = s.grid!;
  const cols = Math.max(1, g.cols.length);
  const inFlow = children.filter((c) => c.style.position !== 'absolute' && c.style.display !== 'none');
  const { cells, rows } = placeGridItems(inFlow.map((c) => c.style.gridItem), cols);
  try {
    f.layoutMode = 'GRID';
    f.gridColumnCount = cols;
    f.gridRowCount = Math.max(rows, g.rows.length);
    f.gridColumnGap = g.colGap ?? s.gap ?? 0;
    f.gridRowGap = g.rowGap ?? s.gap ?? 0;
  } catch (e) {
    renderWarnings.push('"' + f.name + '" uses CSS grid, which this version of Figma can\'t create; laid out as a wrapping row.');
    f.layoutMode = 'HORIZONTAL';
    f.layoutWrap = 'WRAP';
    return undefined;
  }
  return new Map(inFlow.map((c, i) => [c, cells[i]]));
}

/** Track sizes; `fr` tracks can't be used on an axis that hugs its content, so those hug too. */
function sizeTracks(f: FrameNode, s: NormalizedStyle, sizing: { h: Sizing; v: Sizing }): void {
  const apply = (sizes: GridTrackSize[], tracks: GridTrack[], hug: boolean) => {
    sizes.forEach((size, i) => safe(() => {
      const t: GridTrack = tracks[i] ?? 'auto';
      if (t !== 'auto' && 'px' in t) { size.type = 'FIXED'; size.value = t.px; }
      else if (t !== 'auto' && !hug) { size.type = 'FLEX'; size.value = t.fr; }
      else size.type = 'HUG';
    }));
  };
  apply(f.gridColumnSizes, s.grid!.cols, sizing.h === 'HUG');
  // Rows without a template size to their content, like CSS's implicit `auto` rows.
  apply(f.gridRowSizes, s.grid!.rows, true);
}

function appendTo(parent: ParentCtx, node: SceneNode, cell: GridCell | undefined): void {
  if (!cell) { parent.frame.appendChild(node); return; }
  try {
    parent.frame.appendChildAt(node, cell.row, cell.col);
  } catch (e) {
    parent.frame.appendChild(node);
    renderWarnings.push('Could not place "' + node.name + '" in its grid cell; it was added to the next free one.');
    return;
  }
  const item = node as SceneNode & GridChildrenMixin;
  safe(() => { if (cell.colSpan > 1) item.gridColumnSpan = cell.colSpan; });
  safe(() => { if (cell.rowSpan > 1) item.gridRowSpan = cell.rowSpan; });
}

/** CSS absolute position (left/top/right/bottom, % insets, translate) → x/y, then rotation. */
function placeAbsolute(node: SceneNode, s: NormalizedStyle, parent: FrameNode): void {
  const pct = s.insetPct || {};
  const W = parent.width;
  const H = parent.height;
  let x = s.left !== undefined ? s.left + (pct.left ?? 0) * W
    : s.right !== undefined ? W - node.width - s.right - (pct.right ?? 0) * W : 0;
  let y = s.top !== undefined ? s.top + (pct.top ?? 0) * H
    : s.bottom !== undefined ? H - node.height - s.bottom - (pct.bottom ?? 0) * H : 0;
  if (s.translate) {
    x += s.translate.x + s.translate.xPct * node.width;
    y += s.translate.y + s.translate.yPct * node.height;
  }
  node.x = x;
  node.y = y;
  applyRotation(node, s, true);
}

/**
 * A frame with no size whose children are all absolute would collapse in Figma (in CSS it does too,
 * but exports often drop the root's size). Size it to the children's furthest px-positioned edges.
 */
function fitToAbsolute(f: FrameNode, s: NormalizedStyle, sizing: { h: Sizing; v: Sizing }, placed: [SceneNode, NormalizedStyle][]): void {
  const fitW = s.width === undefined && sizing.h === 'HUG';
  const fitH = s.height === undefined && sizing.v === 'HUG';
  if (!fitW && !fitH) return;
  let w = 0;
  let h = 0;
  for (const [n, cs] of placed) {
    if (cs.left !== undefined) w = Math.max(w, fitExtent(cs.left, cs.insetPct?.left ?? 0, cs.translate?.x ?? 0, cs.translate?.xPct ?? 0, n.width));
    if (cs.top !== undefined) h = Math.max(h, fitExtent(cs.top, cs.insetPct?.top ?? 0, cs.translate?.y ?? 0, cs.translate?.yPct ?? 0, n.height));
  }
  if ((fitW && w > 0) || (fitH && h > 0)) f.resize(fitW && w > 0 ? w : f.width, fitH && h > 0 ? h : f.height);
  renderWarnings.push('"' + f.name + '" has no width/height and only absolutely positioned children, so its size was guessed. Add width and height to it for an exact match.');
}

/**
 * Smallest parent size that keeps a child inside it on one axis. The child's near edge sits at
 * `pct * size + offset` (offset = inset px + translate px + translate% of the child), so a centred child
 * (`calc(50% + 0px)` with `translate: -50%`) needs the parent to be at least as big as itself.
 */
export function fitExtent(inset: number, pct: number, tPx: number, tPct: number, size: number): number {
  const offset = inset + tPx + tPct * size;
  let need = 0;
  if (pct < 1) need = Math.max(need, (offset + size) / (1 - pct)); // far edge stays inside
  if (pct > 0 && offset < 0) need = Math.max(need, -offset / pct); // near edge stays inside
  return need;
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
