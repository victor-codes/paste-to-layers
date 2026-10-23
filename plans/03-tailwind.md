# Step 03 — Tailwind mapper

Project: Figma plugin that converts pasted React JSX (Tailwind classes and/or inline `style`) into Figma layers. Repo root: `paste-to-layers/`.

**Worker rules:** edit only the files listed under **Owns**. Never edit `src/types.ts`. If the contract needs to change, stop and report it to the orchestrator. Finish by running `npm run typecheck && npm test` and report the result.

## 03 — Tailwind mapper
**Owns:** `src/tailwind.ts`, `src/tailwind.test.ts`. **Uses:** `colors.ts`.

**Export:** `tailwindToStyle(className: string): { style: NormalizedStyle; unsupported: string[] }`.

**Rules:**
- Strip variant prefixes. Classes with `hover:`, `focus:`, `active:`, `dark:`, `group-*:`, or `md:/lg:/xl:/2xl:` are ignored and reported as unsupported. `sm:` is ignored too.
- `!important` prefix and `-` negatives are supported. Arbitrary values `x-[...]` are supported (px, rem, %, hex, rgb).
- Spacing scale: `n * 4px`, plus `px` = 1 and `0.5` = 2.

**Classes to support:**
- `flex`, `inline-flex`, `block`, `hidden`, `flex-row`, `flex-col`, `flex-wrap`
- `gap-*`, `gap-x-*`, `gap-y-*` (gap-x/gap-y only when they match the direction)
- `p`/`px`/`py`/`pt`/`pr`/`pb`/`pl`-*
- `justify-start|center|end|between`, `items-*`, `self-stretch`
- `w-*`, `h-*`: numeric → FIXED, `full` → FILL, `fit`/`auto` → HUG, `screen` → 1440/900
- `flex-1`/`grow` → widthSizing FILL; `min-w-*`, `max-w-{sm..7xl,prose}`
- `bg-{color}[/opacity]`, `text-{color}`, `border`, `border-{0,2,4,8}`, `border-{color}`
- `rounded`, `rounded-{none,sm,md,lg,xl,2xl,3xl,full=9999}`, plus per-corner `rounded-t/r/b/l/tl/...`
- `shadow-{sm,DEFAULT,md,lg,xl,2xl,none}` using Tailwind's actual values (first layer is enough)
- `opacity-*`, `overflow-hidden`, `absolute`, `relative`, `top-*`, `left-*`
- `text-{xs..9xl}`, which set fontSize and the default lineHeight
- `font-{thin..black}`, `font-sans|serif|mono` (Inter, Georgia, Roboto Mono), `italic`
- `leading-{none,tight,snug,normal,relaxed,loose,N}`, `tracking-{tighter..widest}` (em × fontSize, or em × 16 if no size is set)
- `text-left|center|right|justify`, `uppercase`, `lowercase`, `underline`, `line-through`

Later classes override earlier ones.

**Tests:** one test per group above, plus `p-[13px]`, `bg-black/50`, `hover:bg-red-500` reported as unsupported.

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
