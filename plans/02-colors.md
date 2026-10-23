# Step 02 — Colors

Project: Figma plugin that converts pasted React JSX (Tailwind classes and/or inline `style`) into Figma layers. Repo root: `paste-to-layers/`.

**Worker rules:** edit only the files listed under **Owns**. Never edit `src/types.ts`. If the contract needs to change, stop and report it to the orchestrator. Finish by running `npm run typecheck && npm test` and report the result.

## 02 — Colors
**Owns:** `src/colors.ts`, `src/colors.test.ts`.

**Exports:**
- `parseCssColor(s: string): RGBA | null` handles hex 3/4/6/8 digits, `rgb[a]()`, `hsl[a]()`, named CSS colors (at minimum the basic 16 plus `transparent`, `white`, `black`), and `currentColor` (returns null).
- `tailwindColor(name: string): RGBA | null` takes e.g. `"slate-500"`, `"white"`, `"black"`, `"transparent"`. It covers the full Tailwind v3 default palette, including all shades 50–950 for slate, gray, zinc, neutral, stone, red, orange, amber, yellow, lime, green, emerald, teal, cyan, sky, blue, indigo, violet, purple, fuchsia, pink, and rose.
- `withAlpha(c: RGBA, a: number): RGBA`.

**Tests:** `#fff`, `#11223380`, `rgb(0 0 0 / 50%)`, `hsl(220 50% 50%)`, `blue-500` → `#3b82f6`.

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
