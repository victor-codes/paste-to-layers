import { describe, it, expect } from 'vitest';
import { convert } from './parse';
import type { IRNode } from './types';

const frame = (n: IRNode) => {
  if (n.kind !== 'frame') throw new Error('expected frame, got ' + n.kind);
  return n;
};

describe('convert', () => {
  const card = `
    export default function Card() {
      return (
        <div className="flex flex-col gap-4 p-6 bg-white rounded-lg shadow-md">
          <img src="a.png" alt="Avatar" className="w-16 h-16" />
          <h2 className="text-xl font-bold text-gray-900">Title</h2>
          <p className="text-sm text-gray-500">
            Some
            multiline text
          </p>
          <button className="px-4 py-2 bg-blue-500 text-white rounded">Click</button>
        </div>
      );
    }`;

  it('converts a card', () => {
    const { root } = convert(card);
    const f = frame(root);
    expect(f.name).toBe('Card');
    expect(f.style.direction).toBe('column');
    expect(f.style.gap).toBe(16);
    expect(f.children.map((c) => c.kind)).toEqual(['image', 'text', 'text', 'frame']);
    expect(f.children[0].name).toBe('Avatar');
    const p = f.children[2];
    expect(p.kind === 'text' && p.text).toBe('Some multiline text');
    const btn = frame(f.children[3]);
    expect(btn.style.background).toBeDefined();
    expect(btn.children[0].kind).toBe('text');
    // text style inherited from button
    expect(btn.children[0].style.color).toEqual({ r: 1, g: 1, b: 1, a: 1 });
  });

  it('snapshots the IR', () => {
    expect(convert(card)).toMatchSnapshot();
  });

  it('converts a navbar (arrow default export, fragments, inherited text)', () => {
    const { root } = convert(`
      const Nav = () => (
        <nav className="flex items-center justify-between px-8 py-4 text-gray-700 font-medium">
          <span className="text-lg">Logo</span>
          <ul className="flex gap-6"><li>Home</li><li>About</li></ul>
        </nav>
      );
      export default Nav;`);
    const f = frame(root);
    expect(f.name).toBe('Nav');
    expect(f.style.direction).toBe('row');
    expect(f.style.justify).toBe('between');
    const ul = frame(f.children[1]);
    expect(ul.children).toHaveLength(2);
    expect(ul.children[0].style.fontWeight).toBe(500);
    expect(ul.children[0].style.color).toBeDefined();
  });

  it('renders .map once, and conditionals/ternaries', () => {
    const { root } = convert(`
      export default function List({items, ok}) {
        return (
          <ul className="flex flex-col">
            {items.map(i => <li key={i.id} className="p-2">{i.name}</li>)}
            {ok && <li>yes</li>}
            {ok ? <li>a</li> : <li>b</li>}
          </ul>
        );
      }`);
    const f = frame(root);
    expect(f.children).toHaveLength(3);
    const first = frame(f.children[0]);
    expect(first.children[0].kind === 'text' && first.children[0].text).toBe('{i.name}');
    const third = f.children[2];
    expect(third.kind === 'text' && third.text).toBe('a');
  });

  it('merges inline style over Tailwind and handles literals', () => {
    const { root, warnings } = convert(`
      export default function Box() {
        const c = 'red';
        return <div className="bg-blue-500 p-4 flex" style={{ backgroundColor: '#ff0000', marginTop: -4, width: 200, height: c, padding: \`8px\` }}>hi</div>;
      }`);
    const f = frame(root);
    expect(f.style.background).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect(f.style.width).toBe(200);
    expect(f.style.padding).toEqual({ top: 8, right: 8, bottom: 8, left: 8 });
    expect(warnings.some((w) => w.includes('height'))).toBe(true);
  });

  it('handles clsx/cn class args', () => {
    const { root } = convert(`export default () => <div className={cn('flex gap-2', cond && 'p-4', \`bg-white\`)}>x</div>;`);
    const f = frame(root);
    expect(f.style.gap).toBe(8);
    expect(f.style.padding).toBeDefined();
    expect(f.style.background).toBeDefined();
  });

  it('serialises svg', () => {
    const { root } = convert(`export default () => <div><svg className="w-4" viewBox="0 0 24 24" strokeWidth={2} fill="none"><path strokeLinecap="round" d="M0 0"/></svg></div>`);
    const s = frame(root).children[0];
    expect(s.kind).toBe('svg');
    if (s.kind === 'svg') {
      expect(s.svg).toContain('class="w-4"');
      expect(s.svg).toContain('viewBox="0 0 24 24"');
      expect(s.svg).toContain('stroke-width="2"');
      expect(s.svg).toContain('stroke-linecap="round"');
    }
  });

  it('warns on unknown components and unsupported classes', () => {
    const { root, warnings } = convert(`export default () => <div><Foo className="p-2 zzz-weird"><span>a</span></Foo></div>`);
    const foo = frame(frame(root).children[0]);
    expect(foo.tag).toBe('Foo');
    expect(warnings.some((w) => w.includes('Foo'))).toBe(true);
    expect(warnings.some((w) => w.includes('zzz-weird'))).toBe(true);
    expect(new Set(warnings).size).toBe(warnings.length);
  });

  it('throws readable error on syntax error', () => {
    expect(() => convert('export default () => <div>')).toThrow(/Syntax error/);
  });

  it('falls back to top-level JSX expression', () => {
    const { root } = convert(`<div className="p-2">hi</div>`);
    expect(root.kind).toBe('frame');
  });

  describe('axis fix-ups', () => {
    it('flex-1 stays width FILL in a row parent', () => {
      const f = frame(convert(`export default () => <div className="flex"><div className="flex-1">a</div></div>`).root);
      expect(f.children[0].style.widthSizing).toBe('FILL');
      expect(f.children[0].style.heightSizing).toBeUndefined();
    });
    it('flex-1 becomes height FILL in a column parent', () => {
      const f = frame(convert(`export default () => <div className="flex flex-col"><div className="flex-1">a</div></div>`).root);
      expect(f.children[0].style.heightSizing).toBe('FILL');
      expect(f.children[0].style.widthSizing).toBeUndefined();
    });
    it('block parent counts as column; w-full keeps width FILL', () => {
      const f = frame(convert(`export default () => <div><div className="grow w-full">a</div></div>`).root);
      expect(f.children[0].style.heightSizing).toBe('FILL');
      expect(f.children[0].style.widthSizing).toBe('FILL');
    });
    it('inline flex:1 / flexGrow follow parent direction', () => {
      const col = frame(convert(`export default () => <div style={{display:'flex',flexDirection:'column'}}><div style={{flex:1}}>a</div><div style={{flexGrow:1}}>b</div></div>`).root);
      for (const c of col.children) {
        expect(c.style.heightSizing).toBe('FILL');
        expect(c.style.widthSizing).toBeUndefined();
      }
      const row = frame(convert(`export default () => <div style={{display:'flex'}}><div style={{flexGrow:1}}>b</div></div>`).root);
      expect(row.children[0].style.widthSizing).toBe('FILL');
    });
    it('self-stretch is height FILL in row, width FILL in column', () => {
      const row = frame(convert(`export default () => <div className="flex"><div className="self-stretch">a</div></div>`).root);
      expect(row.children[0].style.heightSizing).toBe('FILL');
      const col = frame(convert(`export default () => <div className="flex flex-col"><div className="self-stretch">a</div></div>`).root);
      expect(col.children[0].style.widthSizing).toBe('FILL');
      expect(col.children[0].style.heightSizing).toBeUndefined();
    });
    it('inline alignSelf: stretch matches self-stretch', () => {
      const row = convert(`export default () => <div style={{display:'flex'}}><div style={{alignSelf:'stretch'}}>a</div></div>`);
      expect(frame(row.root).children[0].style.heightSizing).toBe('FILL');
      expect(row.warnings).toEqual([]);
      const col = frame(convert(`export default () => <div style={{display:'flex',flexDirection:'column'}}><div style={{alignSelf:'stretch',width:'193px'}}>a</div></div>`).root);
      expect(col.children[0].style.widthSizing).toBe('FILL');
      expect(col.children[0].style.heightSizing).toBeUndefined();
    });
    it('default directions', () => {
      expect(frame(convert(`export default () => <div className="flex"><a/></div>`).root).style.direction).toBe('row');
      expect(frame(convert(`export default () => <div><a/></div>`).root).style.direction).toBe('column');
    });
  });
});

describe('mixed inline text', () => {
  const root = (code: string) => convert(code).root;

  it('renders text with inline tags as one text layer with spans', () => {
    const r = root(`const P = () => <p className="text-gray-700">Hello <b>bold</b> and <em className="text-red-500">red <u>u</u></em>!</p>;`);
    expect(r.kind).toBe('text');
    if (r.kind !== 'text') return;
    expect(r.text).toBe('Hello bold and red u!');
    const [b, em, u] = r.spans!;
    expect(r.text.slice(b.start, b.end)).toBe('bold');
    expect(b.style.fontWeight).toBe(700);
    expect(r.text.slice(em.start, em.end)).toBe('red u');
    expect(em.style.fontStyle).toBe('italic');
    expect(em.style.color).toBeDefined();
    expect(r.text.slice(u.start, u.end)).toBe('u');
    expect(u.style.textDecoration).toBe('underline');
    expect(u.style.fontStyle).toBe('italic'); // inherited from <em>
  });

  it('handles <br>, expressions and box parents', () => {
    const r = root(`const B = () => <button className="bg-blue-500 px-4 text-white">Pay {total}<br/><small className="text-xs">incl. tax</small></button>;`);
    expect(r.kind).toBe('frame');
    if (r.kind !== 'frame') return;
    expect(r.children).toHaveLength(1);
    const t = r.children[0];
    expect(t.kind).toBe('text');
    if (t.kind !== 'text') return;
    expect(t.text).toBe('Pay {total}\nincl. tax');
    expect(t.spans![0].style.fontSize).toBe(12);
  });

  it('falls back to separate layers when a child needs its own box or layout', () => {
    const r = root(`const C = () => <p>Status <span className="rounded bg-green-100 px-2">ok</span></p>;`);
    expect(r.kind).toBe('frame');
    const flex = root(`const N = () => <nav className="flex gap-4"><a>Home</a><a>About</a></nav>;`);
    expect(flex.kind === 'frame' && flex.children).toHaveLength(2);
  });
});

describe('design-tool exports (Paper)', () => {
  it('recovers code text that was exported with unescaped <', () => {
    const { root, warnings } = convert(
      `<div className="whitespace-pre"><div className="flex<br />{'  '}gap-4">Hi<br /></div></div>`);
    expect(warnings).toEqual([]);
    expect(root).toMatchObject({ kind: 'text', text: `<div className="flex\n  gap-4">Hi\n</div>` });
  });
  it('turns style objects inside SVGs into CSS and drops the root layout styles', () => {
    const { root } = convert(
      `<svg width="88" height="88" style={{ display: 'inline-block', width: '64px' }}><rect strokeWidth="5" style={{ opacity: '0.9' }} /></svg>`);
    expect(root.kind).toBe('svg');
    if (root.kind !== 'svg') return;
    expect(root.svg).toBe(`<svg width="88" height="88" ><rect stroke-width="5" style="opacity:0.9" /></svg>`);
    expect(root.style.width).toBe(64);
  });
});

describe('Paper page sections', () => {
  it('moves a clipped gradient onto the text', () => {
    const { root } = convert(`<div className="text-transparent bg-clip-text bg-linear-to-r from-red-500 to-red-700">FOUNDATIONAL PURPOSE</div>`);
    expect(root.kind).toBe('text');
    expect(root.style.textGradient?.stops).toHaveLength(2);
    expect(root.style.gradient).toBeUndefined();
  });
  it('uses flex-basis as the main-axis size unless the item grows', () => {
    const f = frame(convert(`<div className="flex"><div className="basis-20 bg-red-500" /><div className="grow basis-20 bg-red-500" /></div>`).root);
    expect(f.children[0].style.width).toBe(80);
    expect(f.children[1].style.width).toBeUndefined();
    expect(f.children[1].style.widthSizing).toBe('FILL');
  });
  it('reads image urls from img src and background-image', () => {
    const f = frame(convert(`<div><img src="https://x.test/a.png" /><div style={{ backgroundImage: 'url(https://x.test/b.jpg)' }} /></div>`).root);
    expect(f.children.map((c) => c.style.imageUrl)).toEqual(['https://x.test/a.png', 'https://x.test/b.jpg']);
  });
});

describe('inline-level elements', () => {
  it('marks spans, buttons and inline-flex as inline, leaves divs block', () => {
    const { root } = convert(`<div className="p-4"><div className="p-2 bg-red-500" /><button className="px-4 bg-blue-500">Go</button><div className="inline-flex p-1 bg-black" /></div>`);
    if (root.kind !== 'frame') throw new Error('expected frame');
    expect(root.children.map((c) => !!c.style.inline)).toEqual([false, true, true]);
  });
});
