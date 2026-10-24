// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableJavaScriptEvaluation":true,"disableJavaScriptFileLoading":true,"disableCSSFileLoading":true,"handleDisabledFileLoadingAsSuccess":true}}
import { describe, expect, it } from 'vitest';
import { convertHtml, htmlToJsx, looksLikeHtml } from './html';
import type { IRNode } from './types';

const find = (n: IRNode, pred: (n: IRNode) => boolean): IRNode | undefined =>
  pred(n) ? n : n.kind === 'frame' ? n.children.map((c) => find(c, pred)).find(Boolean) : undefined;
const text = (n: IRNode, t: string) => find(n, (x) => x.kind === 'text' && x.text.includes(t));

describe('looksLikeHtml', () => {
  it('tells HTML from JSX', () => {
    expect(looksLikeHtml('<!DOCTYPE html><html></html>')).toBe(true);
    expect(looksLikeHtml('<div class="p-4">Hi<br></div>')).toBe(true);
    expect(looksLikeHtml('<div className="p-4">Hi</div>')).toBe(false);
    expect(looksLikeHtml('<div style={{ padding: 4 }} />')).toBe(false);
    expect(looksLikeHtml('export default function A() { return <div /> }')).toBe(false);
  });
});

describe('htmlToJsx', () => {
  it('collapses whitespace like the browser and escapes JSX characters', () => {
    const { code } = htmlToJsx('<p>\n  A quiet {cabin} with a\n  <b>view</b>\n</p>');
    expect(code).toBe('<p>A quiet &#123;cabin&#125; with a <b>view</b></p>');
  });

  it('applies <style> rules by specificity, inline styles last', () => {
    const { code } = htmlToJsx(`<style>
      .card { padding: 8px; color: red }
      div.card { padding: 12px }
      .card:hover { color: blue }
    </style><div class="card" style="color: green">x</div>`);
    expect(code).toContain('style="padding: 12px; color: green"');
    expect(code).not.toContain('class=');
  });

  it('resolves CSS variables through inheritance', () => {
    const { code, warnings } = htmlToJsx(`<style>:root { --brand: #ff0000 } .a { --gap: 4px } .b { color: var(--brand); gap: var(--gap, 2px); margin: var(--nope) }</style>
      <div class="a"><div class="b">x</div></div>`);
    expect(code).toContain('color: #ff0000; gap: 4px');
    expect(code).not.toContain('margin');
    expect(warnings.join()).toContain('--nope');
  });

  it('warns about what it skips', () => {
    const { warnings } = htmlToJsx(`<html><head><link rel="stylesheet" href="x.css"><style>
      @media (min-width: 600px) { .a { padding: 2px } } a:hover { color: red }</style></head>
      <body><script>go()</script><div>x</div></body></html>`);
    const all = warnings.join('\n');
    expect(all).toContain('x.css');
    expect(all).toContain('@media');
    expect(all).toContain(':hover');
    expect(all).toContain('Scripts');
  });
});

describe('convertHtml', () => {
  it('converts a styled page with browser defaults for headings', () => {
    const r = convertHtml(`<!doctype html><html><head><title>Pricing</title><style>
      body { font-family: Inter, sans-serif; color: #111111 }
      .row { display: flex; gap: 16px; padding: 24px; background: #f5f5f5 }
    </style></head><body><div class="row"><h1>Plans</h1><p>Pick one</p></div></body></html>`);
    expect(r.root.name).toBe('Pricing');
    const row = find(r.root, (n) => n.kind === 'frame' && n.style.gap === 16)!;
    expect(row.style.direction).toBe('row');
    const h1 = text(r.root, 'Plans')!;
    expect(h1.style.fontSize).toBe(32);
    expect(h1.style.fontWeight).toBe(700);
    expect(h1.style.color).toMatchObject({ r: 0x11 / 255 });
    expect(r.warnings).toEqual([]);
  });

  it('lets author resets beat browser defaults, and keeps mixed text in one layer', () => {
    const r = convertHtml(`<style>* { margin: 0 } .price { color: #ff0000 }</style>
      <div><h1>Menu</h1><p>Double shot, <em>silky</em> milk. <span class="price">$4.50</span></p></div>`);
    expect(find(r.root, (n) => n.kind === 'frame' && n.tag === 'margin')).toBeUndefined();
    const p = text(r.root, 'Double shot')!;
    expect(p.kind === 'text' && p.text).toBe('Double shot, silky milk. $4.50');
  });

  it('reads Tailwind classes in HTML without browser defaults', () => {
    const r = convertHtml('<div class="flex flex-col gap-2 p-4"><h1 class="text-xl">Hi</h1><img src="https://x.test/a.png" class="w-8 h-8"></div>');
    expect(r.root.style.gap).toBe(8);
    expect(text(r.root, 'Hi')!.style.fontSize).toBe(20);
    expect(find(r.root, (n) => n.kind === 'image' && n.style.imageUrl === 'https://x.test/a.png')).toBeTruthy();
  });

  it('keeps inline SVG', () => {
    const r = convertHtml('<div><svg viewBox="0 0 24 24" width="24" height="24"><path d="M0 0h24" stroke-width="2"/></svg></div>');
    const svg = find(r.root, (n) => n.kind === 'svg');
    expect(svg).toBeTruthy();
  });
});

describe('examples/coffee-menu.html', () => {
  it('converts without errors', async () => {
    // @ts-ignore no @types/node installed
    const { readFileSync } = await import('node:fs');
    const r = convertHtml(readFileSync('examples/coffee-menu.html', 'utf8'));
    expect(r.root.name).toBe('Coffee menu');
    expect(text(r.root, 'Double shot')!.kind).toBe('text');
    expect(r.warnings).toHaveLength(2); // the @media block and :hover
  });
});
