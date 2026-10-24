export type RGBA = { r: number; g: number; b: number; a: number }; // 0..1
export type Sizing = 'HUG' | 'FILL' | 'FIXED';

export interface NormalizedStyle {
  // layout
  display?: 'flex' | 'block' | 'grid' | 'none';
  inline?: boolean;               // inline-level box (span, inline-flex): not stretched by a block parent
  direction?: 'row' | 'column';
  gap?: number;
  padding?: { top: number; right: number; bottom: number; left: number };
  justify?: 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly'; // around/evenly become spacers + between in parse
  align?: 'start' | 'center' | 'end' | 'stretch' | 'baseline';
  wrap?: boolean;
  width?: number; height?: number;
  widthSizing?: Sizing; heightSizing?: Sizing;
  minWidth?: number; maxWidth?: number; minHeight?: number; maxHeight?: number;
  widthPct?: Pct; heightPct?: Pct; // size relative to the parent's content box (`w-1/2`, `calc(100% - 20px)`)
  aspectRatio?: number;           // width / height
  margin?: { top: number; right: number; bottom: number; left: number; autoX?: boolean };
  space?: { x?: number; y?: number };                    // space-x/y-*: gap between children
  divide?: { x?: number; y?: number; color?: RGBA; style?: BorderStyle }; // divide-x/y-*: borders between children
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
  imageUrl?: string;              // background-image: url(...) (first one)
  layers?: BgLayer[];             // every background-image layer, top first as in CSS, when there's more than one
  imageFilters?: ImageAdjust;     // filter: brightness/contrast/saturate/grayscale, applied to image fills
  imageFit?: ImageFit;            // background-size / background-position / object-fit
  clipText?: boolean;             // background-clip: text (the gradient paints the text instead)
  radius?: number | [number, number, number, number]; // tl,tr,br,bl
  border?: { width: number; color: RGBA; sides?: [number, number, number, number]; style?: BorderStyle }; // sides: t,r,b,l widths when they differ
  blur?: number;                  // filter: blur(), CSS radius px
  backdropBlur?: number;          // backdrop-filter: blur(), CSS radius px
  shadows?: Shadow[];
  textShadows?: Shadow[];
  blendMode?: BlendMode;
  scale?: number;                 // uniform CSS scale()
  matrix?: [number, number, number, number]; // CSS transform's linear part (a, b, c, d) when it skews or scales unevenly; replaces rotation/scale
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
  maxLines?: number;              // line-clamp / truncate: cut off with an ellipsis
}

export type Pct = { pct: number; px: number };
export type BorderStyle = 'solid' | 'dashed' | 'dotted';
export interface Shadow { x: number; y: number; blur: number; spread: number; color: RGBA; inset?: boolean }
export type BlendMode = 'MULTIPLY' | 'SCREEN' | 'OVERLAY' | 'DARKEN' | 'LIGHTEN' | 'COLOR_DODGE' | 'COLOR_BURN' |
  'HARD_LIGHT' | 'SOFT_LIGHT' | 'DIFFERENCE' | 'EXCLUSION' | 'HUE' | 'SATURATION' | 'COLOR' | 'LUMINOSITY';
/** Image placement: `cover`/`contain`, or an explicit size (fraction of the box, px, or auto) at a position. */
export interface ImageFit {
  size?: 'cover' | 'contain' | { w: Pct | 'auto'; h: Pct | 'auto' }; // Pct here: fraction of the box plus px
  position?: { x: Pct; y: Pct };  // CSS background-position: pct of (box - image), plus px
  stretch?: boolean;              // object-fit: fill
  repeat?: boolean;               // background-repeat: repeat → tiled
}
export type BgLayer = { gradient: Gradient } | { url: string };
/** CSS filter amounts (1 = unchanged), mapped onto Figma's image adjustments. */
export interface ImageAdjust { brightness?: number; contrast?: number; saturate?: number }

/** Grid track: `fr` share, fixed px, or sized to content. */
export type GridTrack = { fr: number } | { px: number } | 'auto';

/**
 * Gradient; stop positions are 0..1. Linear `angle` follows CSS (0 = to top, 90 = to right). Radial and conic
 * have a centre as a fraction of the box; conic `angle` is CSS's `from`.
 */
export interface Gradient {
  type?: 'linear' | 'radial' | 'conic';
  angle: number;
  stops: { position: number; color: RGBA }[];
  cx?: number; cy?: number;
  circle?: boolean;
  extent?: 'closest-side' | 'farthest-side' | 'closest-corner' | 'farthest-corner' | { x: Pct; y: Pct }; // radial size; Pct = fraction of width/height plus px
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
export type ToSandbox = { type: 'render'; payload: ConvertResult } | { type: 'checks'; image: Uint8Array };

/** Built-in checks (src/checks.ts): exported test layers, scored in the UI against the browser. */
export interface CheckImage { test: string; variant: Record<string, number | boolean>; png: Uint8Array }
export interface CheckResults {
  skew: Record<'free' | 'autoLayout', { kept: boolean; read: number[][]; error: string }>;
  images: CheckImage[];
  calibration: Record<string, unknown>;
}
// sandbox → UI
export type ToUI = { type: 'done'; nodeCount: number; warnings?: string[] } | { type: 'error'; message: string } | { type: 'checks'; results: CheckResults };
