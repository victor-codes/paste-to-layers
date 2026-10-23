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
  gradient?: Gradient;
  radius?: number | [number, number, number, number]; // tl,tr,br,bl
  border?: { width: number; color: RGBA };
  shadows?: { x: number; y: number; blur: number; spread: number; color: RGBA }[];
  opacity?: number;
  overflowHidden?: boolean;
  rotation?: number;              // degrees, clockwise (CSS)
  transformOrigin?: 'center' | 'top-left';
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
