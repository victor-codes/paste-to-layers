export type RGBA = { r: number; g: number; b: number; a: number }; // 0..1
export type Sizing = 'HUG' | 'FILL' | 'FIXED';

export interface NormalizedStyle {
  // layout
  display?: 'flex' | 'block' | 'grid' | 'none';
  inline?: boolean;               // inline-level box (span, inline-flex): not stretched by a block parent
  direction?: 'row' | 'column';
  gap?: number;
  padding?: { top: number; right: number; bottom: number; left: number };
  justify?: 'start' | 'center' | 'end' | 'between';
  align?: 'start' | 'center' | 'end' | 'stretch' | 'baseline';
  wrap?: boolean;
  width?: number; height?: number;
  widthSizing?: Sizing; heightSizing?: Sizing;
  minWidth?: number; maxWidth?: number; minHeight?: number;
  basis?: number;                 // flex-basis px; the main-axis size unless the item grows
  alignSelf?: 'start' | 'center' | 'end';
  grid?: { cols: GridTrack[]; rows: GridTrack[]; colGap?: number; rowGap?: number };
  gridItem?: { colStart?: number; colSpan?: number; rowStart?: number; rowSpan?: number }; // 1-based starts like CSS; span -1 = all tracks
  position?: 'absolute' | 'relative';
  top?: number; left?: number; right?: number; bottom?: number; // px part of the inset
  insetPct?: { top?: number; right?: number; bottom?: number; left?: number }; // fraction of the parent's size (`calc(50% - 8px)`)
  translate?: { x: number; y: number; xPct: number; yPct: number }; // px plus a fraction of the node's own size
  // box
  background?: RGBA;
  gradient?: Gradient;
  imageUrl?: string;              // background-image: url(...)
  clipText?: boolean;             // background-clip: text (the gradient paints the text instead)
  radius?: number | [number, number, number, number]; // tl,tr,br,bl
  border?: { width: number; color: RGBA };
  shadows?: { x: number; y: number; blur: number; spread: number; color: RGBA }[];
  opacity?: number;
  overflowHidden?: boolean;
  rotation?: number;              // degrees, clockwise (CSS)
  transformOrigin?: 'center' | 'top-left';
  // text
  color?: RGBA;
  textGradient?: Gradient;
  fontFamily?: string;
  fontFallbacks?: string[];       // rest of the CSS font stack, generic families dropped
  fontSize?: number;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
  lineHeight?: number | 'auto';   // px
  letterSpacing?: number;         // px
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  textTransform?: 'upper' | 'lower' | 'none';
  textDecoration?: 'underline' | 'line-through' | 'none';
}

/** Grid track: `fr` share, fixed px, or sized to content. */
export type GridTrack = { fr: number } | { px: number } | 'auto';

/** Linear gradient; `angle` follows CSS (0 = to top, 90 = to right), stop positions are 0..1. */
export interface Gradient { angle: number; stops: { position: number; color: RGBA }[] }

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
