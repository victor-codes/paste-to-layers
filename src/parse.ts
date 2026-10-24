import { parse } from '@babel/parser';
import type { ConvertResult, IRNode, NormalizedStyle, TextSpan } from './types';
import { tailwindToStyle } from './tailwind';
import { inlineToStyle } from './inlineStyle';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
type Dir = 'row' | 'column';

const TEXT_KEYS = [
  'color', 'fontFamily', 'fontFallbacks', 'fontSize', 'fontWeight', 'fontStyle',
  'lineHeight', 'letterSpacing', 'textAlign', 'textTransform', 'textGradient', 'textShadows', 'maxLines',
] as const;

/** Phrasing elements that can flow inside a single text layer. */
const INLINE_TAGS = new Set([
  'span', 'b', 'strong', 'i', 'em', 'u', 's', 'del', 'ins', 'mark', 'small', 'code', 'kbd',
  'a', 'abbr', 'cite', 'q', 'sub', 'sup', 'time', 'label', 'br',
]);

/** Inline-level by default in the browser, but rendered as their own layers. */
const INLINE_BOX_TAGS = new Set(['button', 'input', 'select', 'textarea', 'img', 'svg']);

/** Browser default text styles for inline tags (Tailwind preflight keeps these). */
const INLINE_DEFAULTS: Record<string, NormalizedStyle> = {
  b: { fontWeight: 700 }, strong: { fontWeight: 700 },
  i: { fontStyle: 'italic' }, em: { fontStyle: 'italic' }, cite: { fontStyle: 'italic' },
  u: { textDecoration: 'underline' }, ins: { textDecoration: 'underline' },
  s: { textDecoration: 'line-through' }, del: { textDecoration: 'line-through' },
  code: { fontFamily: 'Roboto Mono', fontFallbacks: [] }, kbd: { fontFamily: 'Roboto Mono', fontFallbacks: [] },
};

const CLASS_FNS = new Set(['clsx', 'cn', 'classNames', 'classnames', 'twMerge', 'cx']);

// SVG attributes that must stay camelCase.
const SVG_KEEP_CASE = new Set([
  'viewBox', 'preserveAspectRatio', 'gradientTransform', 'gradientUnits', 'patternUnits',
  'patternTransform', 'patternContentUnits', 'clipPathUnits', 'maskUnits', 'maskContentUnits',
  'markerUnits', 'filterUnits', 'primitiveUnits', 'stdDeviation', 'baseFrequency', 'numOctaves',
  'markerWidth', 'markerHeight', 'refX', 'refY', 'spreadMethod', 'startOffset', 'textLength',
  'pathLength', 'tableValues', 'targetX', 'targetY', 'kernelMatrix', 'surfaceScale',
  'specularConstant', 'specularExponent', 'diffuseConstant', 'stitchTiles', 'xChannelSelector',
  'yChannelSelector', 'zoomAndPan', 'attributeName', 'repeatCount', 'keyTimes', 'keySplines',
]);

function unwrap(n: N): N {
  while (n && (n.type === 'ParenthesizedExpression' || n.type === 'TSAsExpression' ||
    n.type === 'TSNonNullExpression' || n.type === 'TSSatisfiesExpression' || n.type === 'TSTypeAssertion')) {
    n = n.expression;
  }
  return n;
}

const isJsx = (n: N): boolean => !!n && (n.type === 'JSXElement' || n.type === 'JSXFragment');
const isFn = (n: N): boolean =>
  !!n && (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression');

/** Find the first JSX node reachable from an expression (through conditionals, logicals, .map). */
function findJsx(expr: N): N | null {
  const n = unwrap(expr);
  if (!n) return null;
  if (isJsx(n)) return n;
  if (n.type === 'ConditionalExpression') return findJsx(n.consequent) ?? findJsx(n.alternate);
  if (n.type === 'LogicalExpression') return findJsx(n.right) ?? findJsx(n.left);
  if (n.type === 'CallExpression') {
    const c = n.callee;
    if (c.type === 'MemberExpression' && !c.computed && c.property.name === 'map' && isFn(unwrap(n.arguments[0]))) {
      return findJsxInFunction(unwrap(n.arguments[0]));
    }
  }
  return null;
}

function findJsxInStatements(stmts: N[]): N | null {
  for (const s of stmts) {
    const r = findJsxInStatement(s);
    if (r) return r;
  }
  return null;
}

function findJsxInStatement(s: N): N | null {
  if (!s) return null;
  switch (s.type) {
    case 'ReturnStatement': return findJsx(s.argument);
    case 'BlockStatement': return findJsxInStatements(s.body);
    case 'IfStatement': return findJsxInStatement(s.consequent) ?? findJsxInStatement(s.alternate);
    case 'SwitchStatement':
      return findJsxInStatements(s.cases.flatMap((c: N) => c.consequent));
    case 'TryStatement': return findJsxInStatement(s.block);
    default: return null;
  }
}

function findJsxInFunction(fn: N): N | null {
  if (!fn) return null;
  if (fn.body.type === 'BlockStatement') return findJsxInStatements(fn.body.body);
  return findJsx(fn.body);
}

/** Resolve a component expression (function, memo(fn), forwardRef(fn)) to a JSX node. */
function jsxFromComponent(expr: N, top: N[]): N | null {
  const n = unwrap(expr);
  if (!n) return null;
  if (isFn(n)) return findJsxInFunction(n);
  if (n.type === 'CallExpression') {
    for (const a of n.arguments) {
      const r = jsxFromComponent(a, top);
      if (r) return r;
    }
    return null;
  }
  if (n.type === 'Identifier') {
    const d = findTopLevel(top, n.name);
    return d ? jsxFromComponent(d, top) : null;
  }
  return null;
}

/** Look up a top-level declaration by name; returns the function/initialiser expression. */
function findTopLevel(top: N[], name: string): N | null {
  for (const s of top) {
    const d = s.type === 'ExportNamedDeclaration' && s.declaration ? s.declaration : s;
    if (d.type === 'FunctionDeclaration' && d.id?.name === name) return d;
    if (d.type === 'VariableDeclaration') {
      for (const v of d.declarations) if (v.id.type === 'Identifier' && v.id.name === name) return v.init;
    }
  }
  return null;
}

function pickRoot(program: N[]): { jsx: N; name?: string } | null {
  // 1. default export
  for (const s of program) {
    if (s.type !== 'ExportDefaultDeclaration') continue;
    const d = s.declaration;
    const jsx = jsxFromComponent(d, program);
    if (jsx) {
      let name: string | undefined = d.id?.name;
      if (!name && unwrap(d).type === 'Identifier') name = unwrap(d).name;
      return { jsx, name: name ?? 'Component' };
    }
  }
  // 2. last function / arrow component
  let found: { jsx: N; name?: string } | null = null;
  for (const s of program) {
    const d = s.type === 'ExportNamedDeclaration' && s.declaration ? s.declaration : s;
    if (d.type === 'FunctionDeclaration') {
      const jsx = findJsxInFunction(d);
      if (jsx) found = { jsx, name: d.id?.name };
    } else if (d.type === 'VariableDeclaration') {
      for (const v of d.declarations) {
        const init = unwrap(v.init);
        if (init && (isFn(init) || init.type === 'CallExpression')) {
          const jsx = jsxFromComponent(init, program);
          if (jsx) found = { jsx, name: v.id.type === 'Identifier' ? v.id.name : undefined };
        }
      }
    }
  }
  if (found) return found;
  // 3. first top-level JSX expression
  for (const s of program) {
    if (s.type === 'ExpressionStatement') {
      const jsx = findJsx(s.expression);
      if (jsx) return { jsx };
    }
  }
  return null;
}

function staticString(n: N): string | null {
  n = unwrap(n);
  if (!n) return null;
  if (n.type === 'StringLiteral') return n.value;
  if (n.type === 'TemplateLiteral' && n.expressions.length === 0) return n.quasis.map((q: N) => q.value.cooked ?? '').join('');
  return null;
}

/** Collect static class strings from an expression. */
function classStrings(n: N): string[] {
  n = unwrap(n);
  if (!n) return [];
  if (n.type === 'StringLiteral') return [n.value];
  if (n.type === 'TemplateLiteral') {
    const out = n.quasis.map((q: N) => q.value.cooked ?? '');
    for (const e of n.expressions) out.push(...classStrings(e));
    return out;
  }
  if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && CLASS_FNS.has(n.callee.name)) {
    return n.arguments.flatMap(classStrings);
  }
  if (n.type === 'ArrayExpression') return n.elements.flatMap(classStrings);
  if (n.type === 'ConditionalExpression') return classStrings(n.consequent);
  if (n.type === 'LogicalExpression') return classStrings(n.right);
  if (n.type === 'ObjectExpression') {
    // clsx({ 'a b': cond }) – include keys
    return n.properties.flatMap((p: N) =>
      p.type === 'ObjectProperty' && !p.computed
        ? [p.key.type === 'Identifier' ? p.key.name : p.key.type === 'StringLiteral' ? p.key.value : '']
        : []);
  }
  return [];
}

function attrName(a: N): string {
  return a.name.type === 'JSXNamespacedName' ? `${a.name.namespace.name}:${a.name.name.name}` : a.name.name;
}

function getAttr(el: N, ...names: string[]): N | undefined {
  return el.openingElement.attributes.find((a: N) => a.type === 'JSXAttribute' && names.includes(attrName(a)));
}

function attrStatic(a: N | undefined): string | number | null {
  if (!a || !a.value) return null;
  if (a.value.type === 'StringLiteral') return a.value.value;
  if (a.value.type === 'JSXExpressionContainer') {
    const e = unwrap(a.value.expression);
    const s = staticString(e);
    if (s !== null) return s;
    const num = numericValue(e);
    if (num !== null) return num;
  }
  return null;
}

function numericValue(n: N): number | null {
  n = unwrap(n);
  if (!n) return null;
  if (n.type === 'NumericLiteral') return n.value;
  if (n.type === 'UnaryExpression' && (n.operator === '-' || n.operator === '+')) {
    const v = numericValue(n.argument);
    if (v !== null) return n.operator === '-' ? -v : v;
  }
  return null;
}

function tagName(nameNode: N): string {
  switch (nameNode.type) {
    case 'JSXIdentifier': return nameNode.name;
    case 'JSXMemberExpression': return `${tagName(nameNode.object)}.${nameNode.property.name}`;
    case 'JSXNamespacedName': return `${nameNode.namespace.name}:${nameNode.name.name}`;
    default: return 'div';
  }
}

function collapseJsxText(raw: string): string {
  const lines = raw.split(/\r\n|\n|\r/);
  let last = 0;
  for (let i = 0; i < lines.length; i++) if (/[^ \t]/.test(lines[i])) last = i;
  let out = '';
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].replace(/\t/g, ' ');
    if (i !== 0) line = line.replace(/^ +/, '');
    if (i !== lines.length - 1) line = line.replace(/ +$/, '');
    if (line) {
      if (i !== last) line += ' ';
      out += line;
    }
  }
  return out;
}

type Part = { t: 'text'; text: string } | { t: 'node'; node: IRNode };

const hasBox = (s: NormalizedStyle): boolean =>
  !!(s.background || s.gradient || s.imageUrl || s.padding || s.border || s.radius !== undefined || (s.shadows && s.shadows.length));

const DIVIDE_COLOR = { r: 0xe5 / 255, g: 0xe7 / 255, b: 0xeb / 255, a: 1 };

/** How a box sits in its parent: these move to a wrapper frame so the wrapper takes the box's place. */
const LAYOUT_KEYS = ['gridItem', 'alignSelf', 'inline'] as const;
function pickLayout(s: NormalizedStyle): NormalizedStyle {
  const out: NormalizedStyle = {};
  for (const k of LAYOUT_KEYS) if (s[k] !== undefined) (out as Record<string, unknown>)[k] = s[k];
  // A box that fills its parent on an axis makes the wrapper fill it; the box then fills the wrapper.
  if (s.widthSizing === 'FILL') out.widthSizing = 'FILL';
  if (s.heightSizing === 'FILL') out.heightSizing = 'FILL';
  return out;
}
function dropLayout(s: NormalizedStyle): NormalizedStyle {
  const out = { ...s };
  for (const k of LAYOUT_KEYS) delete out[k];
  return out;
}

function pickText(s: NormalizedStyle): NormalizedStyle {
  const out: Record<string, unknown> = {};
  for (const k of TEXT_KEYS) if (s[k] !== undefined) out[k] = s[k];
  return out as NormalizedStyle;
}

/** Text style plus decoration (which applies to a span but isn't inherited by block children). */
function pickSpanText(s: NormalizedStyle): NormalizedStyle {
  const out = pickText(s);
  if (s.textDecoration !== undefined) out.textDecoration = s.textDecoration;
  return out;
}

/**
 * Some exporters (e.g. Paper) write code shown as text without escaping `<`, so text like
 * `<div className="a<br />{'  '}b">` parses as an element. Its string attributes then contain
 * JSX markup (`<br />`, `{' '}`), which never happens in real class names. Recover the text.
 */
function literalTextSource(el: N, code: string): string | null {
  const suspicious = el.openingElement.attributes.some((a: N) =>
    a.type === 'JSXAttribute' && a.value?.type === 'StringLiteral' && /<br\s*\/?>|\{(['"]).*?\1\}/.test(a.value.value));
  if (!suspicious) return null;
  return code.slice(el.start, el.end)
    .replace(/\s*\n\s*/g, '')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/\{(['"])(.*?)\1\}/g, '$2');
}

function snippet(t: string): string {
  const s = t.trim().replace(/\s+/g, ' ');
  return s.length > 30 ? s.slice(0, 30) + '…' : s || 'text';
}

class Converter {
  warnings: string[] = [];
  constructor(private code: string) {}

  warn(m: string) {
    if (!this.warnings.includes(m)) this.warnings.push(m);
  }

  readStyle(el: N): {
    style: NormalizedStyle; classes: string[]; grow: boolean; explicitW: boolean; explicitH: boolean;
  } {
    const cls: string[] = [];
    const ca = getAttr(el, 'className', 'class');
    if (ca?.value) {
      if (ca.value.type === 'StringLiteral') cls.push(ca.value.value);
      else if (ca.value.type === 'JSXExpressionContainer') cls.push(...classStrings(ca.value.expression));
    }
    const classes = cls.join(' ').split(/\s+/).filter(Boolean);
    const tw = tailwindToStyle(classes.join(' '));
    for (const u of tw.unsupported) this.warn(`Unsupported Tailwind class: ${u}`);

    let grow = classes.some((c) => c === 'flex-1' || c === 'grow' || c === 'flex-grow');
    let explicitW = classes.includes('w-full');
    let explicitH = classes.includes('h-full');

    const obj: Record<string, string | number> = {};
    let inlineGrow = false;
    const sa = getAttr(el, 'style');
    if (sa?.value?.type === 'JSXExpressionContainer') {
      const e = unwrap(sa.value.expression);
      if (e.type !== 'ObjectExpression') this.warn('Skipped non-literal style prop');
      else {
        for (const p of e.properties) {
          if (p.type !== 'ObjectProperty' || p.computed) { this.warn('Skipped dynamic style entry'); continue; }
          const key = p.key.type === 'Identifier' ? p.key.name : p.key.type === 'StringLiteral' ? p.key.value : null;
          if (!key) { this.warn('Skipped dynamic style entry'); continue; }
          const v = staticString(p.value) ?? numericValue(p.value);
          if (v === null) { this.warn(`Skipped dynamic style value for "${key}"`); continue; }
          obj[key] = v;
        }
      }
    } else if (sa) this.warn('Skipped non-literal style prop');

    if ('flexGrow' in obj) {
      const g = obj.flexGrow;
      inlineGrow = g !== 0 && g !== '0' && g !== '';
      delete obj.flexGrow;
    }
    if ('flex' in obj) {
      const f = String(obj.flex).trim();
      if (f === '1' || /^1\s+1\s+(0|0px|0%)$/.test(f)) inlineGrow = true;
    }
    // `alignSelf: stretch` is the inline form of `self-stretch`; fixAxes maps it to the parent's cross axis.
    let selfStretch = false;
    if ('alignSelf' in obj) {
      selfStretch = String(obj.alignSelf).trim() === 'stretch';
      if (selfStretch) { delete obj.alignSelf; classes.push('self-stretch'); }
    }
    if (typeof obj.width === 'string' && obj.width.trim() === '100%') explicitW = true;
    if (typeof obj.height === 'string' && obj.height.trim() === '100%') explicitH = true;

    const inl = inlineToStyle(obj);
    for (const u of inl.unsupported) this.warn(`Unsupported inline style: ${u}`);
    const style: NormalizedStyle = { ...tw.style, ...inl.style };
    // `background-clip: text` paints the gradient through the glyphs, so it belongs to the text.
    if (style.clipText) {
      if (style.gradient) { style.textGradient = style.gradient; delete style.gradient; delete style.layers; }
      delete style.clipText;
    }
    if (inlineGrow) { style.widthSizing = 'FILL'; grow = true; }
    if (selfStretch) style.heightSizing = 'FILL';
    return { style, classes, grow, explicitW, explicitH };
  }

  /** Apply axis fix-ups that depend on the parent's direction. */
  fixAxes(
    style: NormalizedStyle, classes: string[], grow: boolean, explicitW: boolean, explicitH: boolean,
    parentDir: Dir | undefined,
  ) {
    if (!parentDir) return;
    // flex-basis sets the main-axis size of items that don't grow (growing items share the space).
    if (style.basis !== undefined && !grow) {
      const axis = parentDir === 'row' ? 'width' : 'height';
      if (style[axis] === undefined) { style[axis] = style.basis; style[axis === 'width' ? 'widthSizing' : 'heightSizing'] = 'FIXED'; }
    }
    if (parentDir === 'column') {
      if (grow) {
        if (!explicitW) {
          if (style.width !== undefined) style.widthSizing = 'FIXED';
          else delete style.widthSizing;
        }
        style.heightSizing = 'FILL';
      }
      if (classes.includes('self-stretch')) {
        if (!explicitH) {
          if (style.height !== undefined) style.heightSizing = 'FIXED';
          else delete style.heightSizing;
        }
        style.widthSizing = 'FILL';
      }
    }
  }

  convertRoot(jsx: N, name: string | undefined): IRNode {
    if (jsx.type === 'JSXFragment') {
      const parts = this.childParts(jsx.children, 'column', {});
      const nodes = this.partsToNodes(parts, {});
      if (nodes.length === 1) {
        const only = nodes[0];
        if (name) only.name = name;
        return only;
      }
      return { kind: 'frame', name: name ?? 'Fragment', tag: 'Fragment', style: { direction: 'column' }, children: nodes };
    }
    const n = this.convertElement(jsx, undefined, {}, name, true);
    return n ?? { kind: 'frame', name: name ?? 'Component', tag: 'div', style: { direction: 'column' }, children: [] };
  }

  convertElement(
    el: N, parentDir: Dir | undefined, inherited: NormalizedStyle, rootName?: string, isRoot = false,
  ): IRNode | null {
    const n = this.convertElementBody(el, parentDir, inherited, rootName, isRoot);
    if (!n) return null;
    if (n.kind === 'frame') this.applyChildSpacing(n);
    if (isRoot) { delete n.style.margin; return n; } // nothing to be spaced from
    return this.applyMargin(n, parentDir);
  }

  /** space-x/y become the gap; divide-x/y become a border on every child after the first. */
  applyChildSpacing(n: Extract<IRNode, { kind: 'frame' }>) {
    this.applyJustify(n);
    const { space, divide, direction } = n.style;
    const axis = direction === 'row' ? 'x' : 'y';
    if (space) {
      if (space[axis] !== undefined && n.style.gap === undefined) n.style.gap = space[axis];
      delete n.style.space;
    }
    if (divide) {
      const w = divide[axis];
      if (w) {
        const color = divide.color ?? DIVIDE_COLOR;
        n.children = n.children.map((c, i) => {
          if (i === 0 || c.style.position === 'absolute') return c;
          // A text layer can't have a border, so it gets a frame to carry it.
          const box: IRNode = c.kind === 'frame' ? c
            : { kind: 'frame', name: c.name, tag: 'div', style: { direction: 'column', ...pickLayout(c.style) }, children: [{ ...c, style: dropLayout(c.style) }] };
          const old = box.style.border;
          const sides: [number, number, number, number] = old ? [...(old.sides ?? [old.width, old.width, old.width, old.width])] : [0, 0, 0, 0];
          sides[axis === 'y' ? 0 : 3] = w;
          box.style.border = { width: Math.max(...sides), color: old?.color ?? color, sides };
          if (divide.style) box.style.border.style = divide.style;
          return box;
        });
      }
      delete n.style.divide;
    }
  }

  /**
   * Figma can only space items "between", so around/evenly get zero-size spacers: with space-between,
   * `S a b S` leaves equal space everywhere (evenly) and `S a S b S` leaves half-size ends (around).
   */
  applyJustify(n: Extract<IRNode, { kind: 'frame' }>) {
    const j = n.style.justify;
    if (j !== 'around' && j !== 'evenly') return;
    const flow = n.children.filter((c) => c.style.position !== 'absolute' && c.style.display !== 'none');
    if (flow.length <= 1) { n.style.justify = 'center'; return; }
    if (n.style.display === 'grid' || n.style.wrap) {
      n.style.justify = 'between';
      this.warn(`justify-${j} on "${n.name}" drawn as space-between (it wraps)`);
      return;
    }
    const spacer = (): IRNode => ({
      kind: 'frame', name: 'spacer', tag: 'spacer',
      style: { width: 0, height: 0, widthSizing: 'FIXED', heightSizing: 'FIXED' }, children: [],
    });
    const out: IRNode[] = [];
    let seen = 0;
    for (const c of n.children) {
      const inFlow = flow.includes(c);
      if (inFlow && (seen === 0 || j === 'around')) out.push(spacer());
      out.push(c);
      if (inFlow) seen++;
    }
    out.push(spacer());
    n.children = out;
    n.style.justify = 'between';
  }

  /**
   * Figma has no margins. An absolutely positioned box just moves; anything else is wrapped in a frame whose
   * padding is the margin (`mx-auto` centres it in a full-width wrapper). Negative margins can't be expressed.
   */
  applyMargin(n: IRNode, parentDir: Dir | undefined): IRNode {
    const m = n.style.margin;
    if (!m) return n;
    delete n.style.margin;
    if (n.style.position === 'absolute') {
      if (n.style.left !== undefined) n.style.left += m.left; else if (n.style.right !== undefined) n.style.right += m.right;
      if (n.style.top !== undefined) n.style.top += m.top; else if (n.style.bottom !== undefined) n.style.bottom += m.bottom;
      return n;
    }
    if ([m.top, m.right, m.bottom, m.left].some((v) => v < 0)) this.warn(`Negative margin on "${n.name}" ignored`);
    const pad = { top: Math.max(0, m.top), right: Math.max(0, m.right), bottom: Math.max(0, m.bottom), left: Math.max(0, m.left) };
    const centre = !!m.autoX && parentDir !== 'row';
    if (!centre && !pad.top && !pad.right && !pad.bottom && !pad.left) return n;
    const style: NormalizedStyle = { direction: 'column', padding: pad, ...pickLayout(n.style) };
    if (centre) { style.align = 'center'; style.widthSizing = 'FILL'; delete style.inline; }
    // Percent sizes are of the parent, so they size the wrapper (plus the margin) and the box fills it.
    const inner = dropLayout(n.style);
    if (inner.widthPct) {
      style.widthPct = { pct: inner.widthPct.pct, px: inner.widthPct.px + pad.left + pad.right };
      delete inner.widthPct; inner.widthSizing = 'FILL';
    }
    if (inner.heightPct) {
      style.heightPct = { pct: inner.heightPct.pct, px: inner.heightPct.px + pad.top + pad.bottom };
      delete inner.heightPct; inner.heightSizing = 'FILL';
    }
    return { kind: 'frame', name: n.name, tag: 'margin', style, children: [{ ...n, style: inner }] } as IRNode;
  }

  convertElementBody(
    el: N, parentDir: Dir | undefined, inherited: NormalizedStyle, rootName?: string, isRoot = false,
  ): IRNode | null {
    const tag = tagName(el.openingElement.name);
    const { style, classes, grow, explicitW, explicitH } = this.readStyle(el);
    if (style.display === 'none' && !isRoot) return null;
    // Inline-level elements keep their content width in block flow; flex parents ignore this.
    if (style.display === undefined && (INLINE_TAGS.has(tag) || INLINE_BOX_TAGS.has(tag))) style.inline = true;
    this.fixAxes(style, classes, grow, explicitW, explicitH, parentDir);

    // Arbitrary properties like [font-synthesis:none] make poor layer names.
    const nameClass = classes.find((c) => !c.startsWith('['));
    const name = rootName ?? (nameClass ? `${tag}.${nameClass}` : tag);
    const effective: NormalizedStyle = { ...inherited, ...pickText(style) };
    const textOf = (s: NormalizedStyle): NormalizedStyle => ({ ...pickText(effective), ...s, ...pickText(effective) });

    if (tag === 'img') {
      const alt = attrStatic(getAttr(el, 'alt'));
      const src = attrStatic(getAttr(el, 'src'));
      if (typeof src === 'string' && /^(https?:|data:image\/)/.test(src)) style.imageUrl = src;
      return { kind: 'image', name: rootName ?? (alt ? String(alt) : 'image'), style };
    }
    if (tag === 'svg') {
      const w = numericOrNull(attrStatic(getAttr(el, 'width')));
      const h = numericOrNull(attrStatic(getAttr(el, 'height')));
      if (style.width === undefined && w !== null) { style.width = w; style.widthSizing ??= 'FIXED'; }
      if (style.height === undefined && h !== null) { style.height = h; style.heightSizing ??= 'FIXED'; }
      return { kind: 'svg', name: rootName ?? name, svg: this.serializeSvg(el), style };
    }

    const isUnknown = /^[A-Z]/.test(tag) || tag.includes('.');
    if (isUnknown && /^[A-Z]/.test(tag.split('.')[0])) this.warn(`Unknown component <${tag}> rendered as a frame`);

    const dir: Dir = style.direction ?? (style.display === 'flex' ? 'row' : 'column');

    if (!isUnknown && style.display !== 'flex' && style.display !== 'grid') {
      const flow = this.inlineFlow(el.children, pickSpanText({ ...effective, ...style }));
      if (flow) {
        const base = hasBox(style) ? pickText(effective) : textOf(style);
        const t: IRNode = { kind: 'text', name: snippet(flow.text), text: flow.text, style: base };
        if (flow.spans.length) t.spans = flow.spans;
        if (!hasBox(style)) return { ...t, name: rootName ?? (classes.length ? name : t.name) };
        return { kind: 'frame', name, tag, style: { ...style, direction: dir }, children: [t] };
      }
    }

    const parts = this.childParts(el.children, dir, effective);

    const texts = parts.filter((p) => p.t === 'text') as { t: 'text'; text: string }[];
    const onlyText = texts.length > 0 && texts.length === parts.length;
    if (onlyText && !isUnknown && !hasBox(style)) {
      const text = texts.map((p) => p.text).join('');
      return { kind: 'text', name: rootName ?? (classes.length ? name : snippet(text)), text, style: textOf(style) };
    }
    if (onlyText && !isUnknown) {
      const text = texts.map((p) => p.text).join('');
      const child: IRNode = { kind: 'text', name: snippet(text), text, style: pickText(effective) };
      return { kind: 'frame', name, tag, style: { ...style, direction: dir }, children: [child] };
    }
    if (onlyText) {
      // unknown component with only text children
      const text = texts.map((p) => p.text).join('');
      const child: IRNode = { kind: 'text', name: snippet(text), text, style: pickText(effective) };
      return { kind: 'frame', name, tag, style: { ...style, direction: dir }, children: [child] };
    }
    return {
      kind: 'frame', name, tag, style: { ...style, direction: dir },
      children: this.partsToNodes(parts, effective),
    };
  }

  /**
   * Flatten text mixed with inline elements (`text <b>bold</b>`) into one string with styled spans.
   * Returns null when there is no inline element, or a child needs its own layer (box/layout styles).
   */
  inlineFlow(children: N[], base: NormalizedStyle): { text: string; spans: TextSpan[] } | null {
    let text = '';
    const spans: TextSpan[] = [];
    let sawElement = false;
    const warnings: string[] = [];

    const walk = (kids: N[], cur: NormalizedStyle): boolean => {
      for (const c of kids) {
        if (c.type === 'JSXText') {
          text += collapseJsxText(c.value);
        } else if (c.type === 'JSXFragment') {
          if (!walk(c.children, cur)) return false;
        } else if (c.type === 'JSXElement') {
          if (!element(c, cur)) return false;
        } else if (c.type === 'JSXExpressionContainer') {
          const e = c.expression;
          if (e.type === 'JSXEmptyExpression') continue;
          const j = findJsx(e);
          if (j) {
            if (j.type === 'JSXFragment' ? !walk(j.children, cur) : !element(j, cur)) return false;
            continue;
          }
          const s = staticString(e);
          const u = unwrap(e);
          text += s ?? (u.type === 'NumericLiteral' ? String(u.value) : `{${this.code.slice(e.start, e.end)}}`);
        } else if (c.type === 'JSXSpreadChild') {
          return false;
        }
      }
      return true;
    };

    const element = (el: N, cur: NormalizedStyle): boolean => {
      const literal = literalTextSource(el, this.code);
      if (literal !== null) { sawElement = true; text += literal; return true; }
      const tag = tagName(el.openingElement.name);
      if (!INLINE_TAGS.has(tag)) return false;
      sawElement = true;
      if (tag === 'br') { text += '\n'; return true; }
      const { style } = this.readStyle(el);
      if (style.display === 'none') return true;
      if (hasBox(style) || style.display || style.direction || style.width !== undefined ||
          style.height !== undefined || style.position === 'absolute' || style.margin) return false;
      const spanStyle = { ...cur, ...INLINE_DEFAULTS[tag], ...pickSpanText(style) };
      // Reserve the slot first so outer spans are applied before nested ones.
      const span: TextSpan = { start: text.length, end: text.length, style: spanStyle };
      spans.push(span);
      if (!walk(el.children, spanStyle)) return false;
      span.end = text.length;
      return true;
    };

    // readStyle warns directly; only keep those warnings if the flow is actually used.
    const saved = this.warnings;
    this.warnings = warnings;
    const ok = walk(children, base);
    this.warnings = saved;
    if (!ok || !sawElement) return null;
    for (const w of warnings) this.warn(w);

    // Trim surrounding whitespace and shift spans to match.
    const lead = text.length - text.replace(/^\s+/, '').length;
    const trimmed = text.trim();
    if (!trimmed) return null;
    const out: TextSpan[] = [];
    for (const sp of spans) {
      const start = Math.max(0, sp.start - lead);
      const end = Math.min(trimmed.length, sp.end - lead);
      if (end > start) out.push({ start, end, style: sp.style });
    }
    return { text: trimmed, spans: out };
  }

  partsToNodes(parts: Part[], effective: NormalizedStyle): IRNode[] {
    const out: IRNode[] = [];
    for (const p of parts) {
      if (p.t === 'node') out.push(p.node);
      else if (p.text.trim()) {
        out.push({ kind: 'text', name: snippet(p.text), text: p.text.trim(), style: pickText(effective) });
      }
    }
    return out;
  }

  childParts(children: N[], dir: Dir, effective: NormalizedStyle): Part[] {
    const parts: Part[] = [];
    const pushJsx = (j: N) => {
      const literal = j.type === 'JSXElement' ? literalTextSource(j, this.code) : null;
      if (literal !== null) {
        parts.push({ t: 'text', text: literal });
      } else if (j.type === 'JSXFragment') {
        parts.push(...this.childParts(j.children, dir, effective));
      } else {
        const node = this.convertElement(j, dir, pickText(effective));
        if (node) parts.push({ t: 'node', node });
      }
    };
    for (const c of children) {
      if (c.type === 'JSXText') {
        const t = collapseJsxText(c.value);
        if (t) parts.push({ t: 'text', text: t });
      } else if (c.type === 'JSXElement' || c.type === 'JSXFragment') {
        pushJsx(c);
      } else if (c.type === 'JSXExpressionContainer') {
        const e = c.expression;
        if (e.type === 'JSXEmptyExpression') continue;
        const j = findJsx(e);
        if (j) { pushJsx(j); continue; }
        const s = staticString(e);
        if (s !== null) { if (s) parts.push({ t: 'text', text: s }); continue; }
        const u = unwrap(e);
        if (u.type === 'NumericLiteral') { parts.push({ t: 'text', text: String(u.value) }); continue; }
        parts.push({ t: 'text', text: `{${this.code.slice(e.start, e.end)}}` });
      } else if (c.type === 'JSXSpreadChild') {
        parts.push({ t: 'text', text: `{...${this.code.slice(c.expression.start, c.expression.end)}}` });
      }
    }
    return parts;
  }

  serializeSvg(el: N): string {
    const start: number = el.start;
    // The root's layout styles (size, display, flex) are applied to the Figma node instead.
    const rootStyle = getAttr(el, 'style');
    const edits: { s: number; e: number; text: string }[] = [];
    const visit = (n: N) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) { n.forEach(visit); return; }
      if (n.type === 'JSXAttribute') {
        const name = attrName(n);
        let out = name;
        if (name === 'className') out = 'class';
        else if (name === 'htmlFor') out = 'for';
        else if (/^xlink[A-Z]/.test(name)) out = 'xlink:' + name.slice(5).toLowerCase();
        else if (!SVG_KEEP_CASE.has(name) && /[a-z][A-Z]/.test(name)) {
          out = name.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
        }
        const nameEdit = out !== name ? { s: n.name.start, e: n.name.end, text: out } : null;
        if (n.value?.type !== 'JSXExpressionContainer') { if (nameEdit) edits.push(nameEdit); return; }
        const e = unwrap(n.value.expression);
        let v: string | number | null = staticString(e) ?? numericValue(e);
        if (v === null && name === 'style' && e?.type === 'ObjectExpression') v = cssText(e, n === rootStyle);
        // Figma's SVG parser only accepts plain attributes; drop anything dynamic.
        if (v === null || v === '') { edits.push({ s: n.start, e: n.end, text: '' }); return; }
        if (nameEdit) edits.push(nameEdit);
        edits.push({ s: n.value.start, e: n.value.end, text: `"${String(v).replace(/"/g, '&quot;')}"` });
        return;
      }
      for (const k of Object.keys(n)) {
        if (k === 'loc' || k === 'start' || k === 'end' || k === 'type') continue;
        visit(n[k]);
      }
    };
    visit(el.openingElement.attributes);
    visit(el.children);
    let out = this.code.slice(start, el.end);
    for (const ed of edits.sort((a, b) => b.s - a.s)) {
      out = out.slice(0, ed.s - start) + ed.text + out.slice(ed.e - start);
    }
    return out;
  }
}

const SVG_LAYOUT_PROPS = new Set(['display', 'width', 'height', 'flexShrink', 'flexGrow', 'flex', 'margin', 'position']);

/** Static style object → CSS declarations (`strokeWidth: 2` → `stroke-width:2`). */
function cssText(obj: N, isRoot: boolean): string | null {
  const decls: string[] = [];
  for (const p of obj.properties) {
    if (p.type !== 'ObjectProperty' || p.computed) continue;
    const key = p.key.type === 'Identifier' ? p.key.name : p.key.type === 'StringLiteral' ? p.key.value : null;
    const v = staticString(p.value) ?? numericValue(p.value);
    if (!key || v === null || (isRoot && SVG_LAYOUT_PROPS.has(key))) continue;
    decls.push(`${String(key).replace(/[A-Z]/g, (m: string) => '-' + m.toLowerCase())}:${v}`);
  }
  return decls.join(';');
}

function numericOrNull(v: string | number | null): number | null {
  if (v === null) return null;
  const n = typeof v === 'number' ? v : /^-?\d*\.?\d+(px)?$/.test(v.trim()) ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function convert(code: string): ConvertResult {
  let ast: N;
  try {
    ast = parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
  } catch (e) {
    throw new Error(`Syntax error: ${e instanceof Error ? e.message : String(e)}`);
  }
  const picked = pickRoot(ast.program.body);
  if (!picked) throw new Error('No JSX found in the pasted code');
  const conv = new Converter(code);
  const root = conv.convertRoot(picked.jsx, picked.name);
  return { root, warnings: [...new Set(conv.warnings)] };
}
