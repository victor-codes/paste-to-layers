# Step 06 — Figma renderer (sandbox)

Project: Figma plugin that converts pasted React JSX (Tailwind classes and/or inline `style`) into Figma layers. Repo root: `paste-to-layers/`.

**Worker rules:** edit only the files listed under **Owns**. Never edit `src/types.ts`. If the contract needs to change, stop and report it to the orchestrator. Finish by running `npm run typecheck && npm test` and report the result.

## 06 — Figma renderer (sandbox)
**Owns:** `src/render.ts` (no tests; needs the figma runtime). **Uses:** types only.

**Export:** `async function render(root: IRNode): Promise<{ node: SceneNode; count: number }>`.

- **Fonts:** before creating anything, walk the IR and collect `{family, style}` pairs. Weight map: 100 Thin, 200 Extra Light, 300 Light, 400 Regular, 500 Medium, 600 Semi Bold, 700 Bold, 800 Extra Bold, 900 Black; add " Italic" (or just "Italic" at 400). Load each with `loadFontAsync`. On failure, fall back to Inter at the same style, then Inter Regular. Keep a resolved-font cache.
- **frame:**
  - `figma.createFrame()`, `fills=[]` unless a background is set, `clipsContent = overflowHidden ?? false`.
  - If display is not `none`: `layoutMode = direction==='row' ? 'HORIZONTAL' : 'VERTICAL'`.
  - `itemSpacing` (or `'AUTO'` spacing when justify is `between`), padding, `primaryAxisAlignItems` (MIN/CENTER/MAX/SPACE_BETWEEN), `counterAxisAlignItems` (MIN/CENTER/MAX/BASELINE; `stretch` → set child `layoutAlign='STRETCH'`), `layoutWrap`.
  - Radius (single value or per corner), stroke (`strokes`, `strokeWeight`, `strokeAlign='INSIDE'`), `DROP_SHADOW` effects, opacity.
  - Skip nodes with `display:none`.
- **Sizing:** after appending to the parent, set `layoutSizingHorizontal`/`Vertical` from the sizing values. FILL is only valid inside an auto-layout parent, so fall back to HUG at the root. FIXED uses `resize(width, height)`, keeping the current value for whichever side isn't given.
- **text:**
  - `createText`; load the font first.
  - Set `characters`, fontSize, `lineHeight` `{unit:'PIXELS'}` or AUTO, `letterSpacing` `{unit:'PIXELS'}`, `textAlignHorizontal`, `textCase`, `textDecoration`, and fills from color (default black).
  - Inside a parent with fixed or fill width, use `textAutoResize='HEIGHT'` + `layoutSizingHorizontal='FILL'`; otherwise `WIDTH_AND_HEIGHT`.
- **image:** rectangle 120×80 by default (or the given w/h) with fill `#E5E7EB` and the given radius.
- **svg:** `figma.createNodeFromSvg(svg)` inside a try block. On failure, use a placeholder rectangle and add a warning.
- **absolute:** `layoutPositioning='ABSOLUTE'` plus x/y from top/left.

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
