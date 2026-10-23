# Step 05 — JSX parser → IR

Project: Figma plugin that converts pasted React JSX (Tailwind classes and/or inline `style`) into Figma layers. Repo root: `paste-to-layers/`.

**Worker rules:** edit only the files listed under **Owns**. Never edit `src/types.ts`. If the contract needs to change, stop and report it to the orchestrator. Finish by running `npm run typecheck && npm test` and report the result.

## 05 — JSX parser → IR
**Owns:** `src/parse.ts`, `src/parse.test.ts`. **Uses:** `tailwind.ts`, `inlineStyle.ts`, `@babel/parser`.

**Export:** `convert(code: string): ConvertResult`. It throws `Error` with a readable message on syntax errors.

**Steps:**
1. Parse with `plugins: ['jsx','typescript']` and `sourceType: 'module'`.
2. Pick the root JSX:
   - Prefer the default-exported component.
   - Otherwise use the last function/arrow component, taking the first `return` that holds JSX (or an arrow function's expression body).
   - Otherwise use the first top-level JSX expression.
   - Unwrap fragments and parentheses.
3. Per element:
   - Combine `className`/`class` (string literal, template literal static parts, `clsx`/`cn` string args) through `tailwindToStyle`.
   - Merge `style={{...}}` (static literal values only) through `inlineToStyle` over it, so inline styles win.
4. Node kind:
   - `img` → image (name = alt).
   - `svg` → svg (re-serialize the JSX source slice using `code.slice(start,end)` and convert `className` → `class` and camelCase attrs like `strokeWidth` → `stroke-width`).
   - Element whose children are only text/expressions and that has no box styles → text.
   - With box styles (bg/padding/border/radius) → frame wrapping a text child, with text styles inherited.
   - Everything else → frame. Block tags with no `display:flex` → `direction:'column'`.
5. Text inheritance: color, font*, lineHeight, letterSpacing, textAlign, and textTransform pass down to descendants.
6. Children:
   - Collapse JSX whitespace the way React does.
   - `{expr}` → text `{exprSource}`.
   - `{arr.map(x => <X/>)}` → render the callback's JSX once.
   - `{cond && <X/>}` / ternary → render the first JSX branch.
7. Unknown capitalised components → frame named after the component, rendered from its children (add a warning).
8. Name: the component name for the root; otherwise the tag, or the first class plus the tag.
9. Collect every `unsupported` entry into `warnings` (deduplicated).

**Tests:** a card, a navbar, a `.map` list, a mixed inline+Tailwind component, a syntax error, and a snapshot of the IR.

## Shared contract (copied verbatim into every step file)

`src/types.ts`:
```ts
export type RGBA = { r: number; g: number; b: number; a: number }; // 0..1
export type Sizing = 'HUG' | 'FILL' | 'FIXED';

export interface NormalizedStyle {
  // layout
  display?: 'flex' | 'block' | 'none';
  direction?: 'row' | 'column';
  gap?: number;
  padding?: { top: number; right: number; bottom: number; left: number };
  justify?: 'start' | 'center' | 'end' | 'between';
  align?: 'start' | 'center' | 'end' | 'stretch' | 'baseline';
  wrap?: boolean;
  width?: number; height?: number;
  widthSizing?: Sizing; heightSizing?: Sizing;
  minWidth?: number; maxWidth?: number;
  position?: 'absolute' | 'relative';
  top?: number; left?: number;
  // box
  background?: RGBA;
  radius?: number | [number, number, number, number]; // tl,tr,br,bl
  border?: { width: number; color: RGBA };
  shadows?: { x: number; y: number; blur: number; spread: number; color: RGBA }[];
  opacity?: number;
  overflowHidden?: boolean;
  // text
  color?: RGBA;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
  lineHeight?: number | 'auto';   // px
  letterSpacing?: number;         // px
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  textTransform?: 'upper' | 'lower' | 'none';
  textDecoration?: 'underline' | 'line-through' | 'none';
}

export type IRNode =
  | { kind: 'frame'; name: string; tag: string; style: NormalizedStyle; children: IRNode[] }
  | { kind: 'text'; name: string; text: string; style: NormalizedStyle; spans?: TextSpan[] }
  | { kind: 'image'; name: string; style: NormalizedStyle }
  | { kind: 'svg'; name: string; svg: string; style: NormalizedStyle };

/** Styled character range inside a text node; `style` is the full text style for that range. */
export interface TextSpan { start: number; end: number; style: NormalizedStyle }

export interface ConvertResult { root: IRNode; warnings: string[] }

// UI → sandbox
export type ToSandbox = { type: 'render'; payload: ConvertResult };
// sandbox → UI
export type ToUI = { type: 'done'; nodeCount: number; warnings?: string[] } | { type: 'error'; message: string };
```

**Conventions:**
- All lengths are in px numbers, with `1rem = 16px`.
- Pure modules (02–05) must not import from `figma`.
- Tests sit next to each module as `*.test.ts` and use vitest.
