/**
 * Plain HTML input (pasted or dropped as a file). The browser parses it, `<style>` rules are resolved onto
 * each element's style attribute, and the result is written out as JSX for the regular converter.
 * Runs in the plugin UI, which has a DOM.
 */
import { convert, INLINE_BOX_TAGS, INLINE_TAGS } from './parse';
import { parseDeclarations, splitCss, type Declaration } from './inlineStyle';
import { tailwindToStyle } from './tailwind';
import type { ConvertResult } from './types';

/** HTML rather than JSX: a document, or markup with no JSX-only syntax (`className`, `={…}`, `<>`). */
export function looksLikeHtml(src: string): boolean {
  const t = src.trimStart();
  if (/^(<!doctype|<html|<!--)/i.test(t)) return true;
  return t.startsWith('<') && !/className|=\s*\{|<>/.test(src);
}

export function convertHtml(src: string): ConvertResult {
  const { code, name, warnings } = htmlToJsx(src);
  let r: ConvertResult;
  try {
    r = convert(code, name);
  } catch (e) {
    // Positions would point into the generated JSX, not the pasted HTML.
    const msg = (e instanceof Error ? e.message : String(e)).replace(/\s*\(\d+:\d+\)\s*$/, '');
    throw new Error(`Could not convert this HTML: ${msg}`);
  }
  return { root: r.root, warnings: [...new Set([...warnings, ...r.warnings])] };
}

/** Browser defaults that matter for layout, used when the page isn't Tailwind (whose preflight resets them). */
const UA_CSS = `
h1{font-size:32px;font-weight:700;margin-bottom:21.44px}
h2{font-size:24px;font-weight:700;margin-bottom:19.92px}
h3{font-size:18.72px;font-weight:700;margin-bottom:18.72px}
h4{font-size:16px;font-weight:700;margin-bottom:21.28px}
h5{font-size:13.28px;font-weight:700;margin-bottom:22.18px}
h6{font-size:10.72px;font-weight:700;margin-bottom:24.98px}
p,ul,ol,dl,blockquote,pre,figure,table{margin-bottom:16px}
ul,ol{padding-left:40px}
blockquote,figure{margin-left:40px;margin-right:40px}
th{font-weight:700}
a{color:#0000ee;text-decoration:underline}
`;

const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'head', 'meta', 'link', 'title', 'base']);
const INHERITED = new Set([
  'color', 'font', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height',
  'letter-spacing', 'text-align', 'text-transform',
]);
/** Pseudo-classes that only depend on the document's structure, so they can be matched statically. */
const STRUCTURAL = /^:(first-child|last-child|only-child|nth-child|nth-last-child|first-of-type|last-of-type|nth-of-type|only-of-type|not|is|where|root|empty)\b/;

interface Rule { selector: string; spec: number; decls: Declaration[] }

/** Browser default rules rank below every author rule, whatever their specificity. */
const UA_RANK = -1e8;

/** Selector specificity as one sortable number (ids, then classes/attributes/pseudo-classes, then tags). */
function specificity(sel: string): number {
  const s = sel.replace(/\[[^\]]*\]/g, '.a').replace(/:(not|is)\(/g, ' (').replace(/:where\([^)]*\)/g, '');
  const ids = (s.match(/#[\w-]+/g) ?? []).length;
  const classes = (s.match(/\.[\w-]+|:[\w-]+/g) ?? []).length;
  const tags = (s.match(/(^|[\s>+~(])[a-zA-Z][\w-]*/g) ?? []).length;
  return ids * 1e6 + classes * 1e3 + tags;
}

/** Index of the brace closing the block that opens at `open`. */
function closing(css: string, open: number): number {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return i;
  }
  return css.length;
}

class HtmlReader {
  warnings: string[] = [];
  rules: Rule[] = [];
  skippedStates = new Set<string>();
  skippedMedia = 0;
  /** Class names some stylesheet rule refers to; they're resolved here, not read as Tailwind. */
  cssClasses = new Set<string>();

  warn(m: string) { if (!this.warnings.includes(m)) this.warnings.push(m); }

  readCss(css: string, base = 0) {
    css = css.replace(/\/\*[\s\S]*?\*\//g, '');
    let i = 0;
    while (i < css.length) {
      const open = css.indexOf('{', i);
      const semi = css.indexOf(';', i);
      if (open < 0) break;
      // Statement at-rules (`@import url(…);`) end at a semicolon before any block.
      if (semi >= 0 && semi < open && css.slice(i, semi).trim().startsWith('@')) {
        const at = css.slice(i, semi).trim();
        if (at.startsWith('@import')) this.warn(`External stylesheets aren't loaded: ${at}`);
        i = semi + 1;
        continue;
      }
      const prelude = css.slice(i, open).trim();
      const end = closing(css, open);
      const body = css.slice(open + 1, end);
      i = end + 1;
      if (prelude.startsWith('@')) {
        const at = /^@([\w-]+)/.exec(prelude)?.[1] ?? '';
        if (at === 'layer' || at === 'supports' || (at === 'media' && !prelude.includes('('))) this.readCss(body, base);
        else if (at === 'media') this.skippedMedia++;
        continue;
      }
      const decls = parseDeclarations(body);
      if (!decls.length) continue;
      for (let sel of splitCss(prelude, ',')) {
        sel = sel.trim().replace(/:root\b/g, 'html');
        if (!sel) continue;
        const pseudo = sel.replace(/\[[^\]]*\]/g, '').match(/::?[\w-]+/g)?.find((p) => !STRUCTURAL.test(p));
        if (pseudo) { this.skippedStates.add(pseudo); continue; }
        for (const m of sel.matchAll(/\.([\w-]+)/g)) this.cssClasses.add(m[1]);
        this.rules.push({ selector: sel, spec: base + specificity(sel), decls });
      }
    }
  }

  /** Every element's cascaded declarations, in the order they should be applied. */
  cascade(doc: Document): Map<Element, Declaration[]> {
    const hits = new Map<Element, { rank: number; order: number; d: Declaration }[]>();
    const add = (el: Element, rank: number, order: number, d: Declaration) => {
      let list = hits.get(el);
      if (!list) hits.set(el, (list = []));
      list.push({ rank, order, d });
    };
    let order = 0;
    for (const r of this.rules) {
      let els: Element[];
      try { els = [...doc.querySelectorAll(r.selector)]; } catch { this.warn(`Skipped CSS selector the browser couldn't read: ${r.selector}`); continue; }
      for (const el of els) for (const d of r.decls) add(el, (d.important ? 2e9 : 0) + r.spec, order++, d);
    }
    for (const el of doc.querySelectorAll('[style]')) {
      for (const d of parseDeclarations(el.getAttribute('style') ?? '')) add(el, (d.important ? 3e9 : 1e9), order++, d);
    }
    const out = new Map<Element, Declaration[]>();
    for (const [el, list] of hits) {
      list.sort((a, b) => a.rank - b.rank || a.order - b.order);
      // Later wins; re-inserting keeps the winner in cascade order so longhands still follow shorthands.
      const merged = new Map<string, Declaration>();
      for (const { d } of list) { merged.delete(d.prop); merged.set(d.prop, d); }
      out.set(el, [...merged.values()]);
    }
    return out;
  }
}

/** Replaces `var(--x, fallback)` using the custom properties in scope; unresolved names are collected. */
function substituteVars(v: string, vars: Map<string, string>, missing: Set<string>, depth = 0): string {
  let out = '';
  let i = 0;
  for (;;) {
    const j = v.indexOf('var(', i);
    if (j < 0) return out + v.slice(i);
    out += v.slice(i, j);
    let d = 0;
    let k = j + 3;
    for (; k < v.length; k++) {
      if (v[k] === '(') d++;
      else if (v[k] === ')' && --d === 0) break;
    }
    const [name, ...rest] = splitCss(v.slice(j + 4, k), ',');
    const fallback = rest.length ? rest.join(',').trim() : undefined;
    let r = vars.get(name.trim()) ?? fallback;
    if (r === undefined) { missing.add(name.trim()); r = ''; }
    out += depth < 8 ? substituteVars(r, vars, missing, depth + 1) : r;
    i = k + 1;
  }
}

const escText = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');
const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const isInline = (n: Node | null) =>
  !!n && (n.nodeType === 3 || (n.nodeType === 1 && (INLINE_TAGS.has((n as Element).localName) || INLINE_BOX_TAGS.has((n as Element).localName))));

/** Pasted HTML → JSX the converter reads, plus a component name and warnings. */
export function htmlToJsx(src: string): { code: string; name?: string; warnings: string[] } {
  const doc = new DOMParser().parseFromString(src, 'text/html');
  const reader = new HtmlReader();
  const tailwind = /tailwind/i.test(src) || !/<style[\s>]|\sstyle\s*=/i.test(src);

  if (!tailwind) reader.readCss(UA_CSS, UA_RANK);
  for (const s of doc.querySelectorAll('style')) reader.readCss(s.textContent ?? '');
  for (const l of doc.querySelectorAll('link[rel~="stylesheet"]')) reader.warn(`External stylesheets aren't loaded: ${l.getAttribute('href')}`);
  if ([...doc.querySelectorAll('script')].some((s) => !/tailwind/i.test(s.getAttribute('src') ?? ''))) {
    reader.warn("Scripts aren't run, so anything they would add to the page is missing");
  }
  if (reader.skippedMedia) reader.warn(`Skipped ${reader.skippedMedia} @media block${reader.skippedMedia === 1 ? '' : 's'} (screen sizes and dark mode aren't converted)`);
  if (reader.skippedStates.size) reader.warn(`Skipped CSS rules for states and pseudo-elements: ${[...reader.skippedStates].slice(0, 6).join(', ')}`);

  const styles = reader.cascade(doc);
  // Inherited text styles set on <html> carry over to <body>, which becomes the root frame.
  const htmlDecls = (styles.get(doc.documentElement) ?? []).filter((d) => INHERITED.has(d.prop) || d.prop.startsWith('--'));
  if (htmlDecls.length) styles.set(doc.body, [...htmlDecls, ...(styles.get(doc.body) ?? [])]);

  const missing = new Set<string>();
  const keepClass = (c: string) => !reader.cssClasses.has(c) && (tailwind || !tailwindToStyle(c).unsupported.length);

  const attrs = (el: Element, vars: Map<string, string>): string => {
    let out = '';
    for (const a of el.attributes) {
      const n = a.name;
      if (n === 'style' || /^on/i.test(n) || !/^[A-Za-z_][\w.-]*(:[\w-]+)?$/.test(n)) continue;
      let v = a.value;
      if (n === 'class') { v = v.split(/\s+/).filter((c) => c && keepClass(c)).join(' '); if (!v) continue; }
      out += ` ${n}="${escAttr(v)}"`;
    }
    const css = (styles.get(el) ?? [])
      .filter((d) => !d.prop.startsWith('--'))
      .map((d) => {
        const before = missing.size;
        const value = substituteVars(d.value, vars, missing);
        return missing.size > before && !value.trim() ? '' : `${d.prop}: ${value}`;
      })
      .filter(Boolean)
      .join('; ');
    if (css) out += ` style="${escAttr(css)}"`;
    return out;
  };

  const text = (t: Node, block: boolean, pre: boolean): string => {
    const raw = t.textContent ?? '';
    if (pre) return raw ? `{${JSON.stringify(raw)}}` : '';
    let s = raw.replace(/[ \t\n\r\f]+/g, ' ');
    const prev = t.previousSibling;
    const next = t.nextSibling;
    const startsLine = (!prev && block) || (!!prev && (!isInline(prev) || (prev as Element).localName === 'br'));
    const endsLine = (!next && block) || (!!next && !isInline(next));
    if (startsLine) s = s.trimStart();
    if (endsLine) s = s.trimEnd();
    return escText(s);
  };

  /** Custom properties in scope on `el`: its own on top of the inherited ones. */
  const scope = (el: Element, parentVars: Map<string, string>): Map<string, string> => {
    const own = (styles.get(el) ?? []).filter((d) => d.prop.startsWith('--'));
    if (!own.length) return parentVars;
    const vars = new Map(parentVars);
    for (const d of own) vars.set(d.prop, substituteVars(d.value, parentVars, missing));
    return vars;
  };

  const element = (el: Element, parentVars: Map<string, string>, pre: boolean, tag = el.localName): string => {
    if (SKIP_TAGS.has(el.localName)) return '';
    const vars = scope(el, parentVars);
    const inPre = pre || el.localName === 'pre';
    const block = !isInline(el);
    let kids = '';
    for (const c of el.childNodes) {
      if (c.nodeType === 1) kids += element(c as Element, vars, inPre);
      else if (c.nodeType === 3) kids += text(c, block, inPre);
    }
    const open = `<${tag}${attrs(el, vars)}`;
    return kids ? `${open}>${kids}</${tag}>` : `${open} />`;
  };

  const full = /<(html|body)[\s>]|<!doctype/i.test(src);
  const body = doc.body;
  const elements = [...body.children].filter((c) => !SKIP_TAGS.has(c.localName));
  const loneText = [...body.childNodes].some((c) => c.nodeType === 3 && c.textContent!.trim());
  let code: string;
  if (!full && elements.length === 1 && !loneText) {
    // The lone element is the root: it still inherits the text styles and variables set on <html>/<body>.
    const root = elements[0];
    const inherited = (styles.get(body) ?? []).filter((d) => INHERITED.has(d.prop));
    if (inherited.length) styles.set(root, [...inherited, ...(styles.get(root) ?? [])]);
    code = element(root, scope(body, new Map()), false);
  } else code = element(body, new Map(), false, 'div');
  if (missing.size) reader.warn(`Undefined CSS variables were left out: ${[...missing].slice(0, 6).join(', ')}`);

  const title = doc.title.trim();
  const name = title ? title.slice(0, 60) : full ? 'Page' : undefined;
  return { code: code || '<div />', name, warnings: reader.warnings };
}
