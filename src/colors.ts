import type { RGBA } from './types';

const NAMED: Record<string, string> = {
  black: '#000000', silver: '#c0c0c0', gray: '#808080', grey: '#808080', white: '#ffffff',
  maroon: '#800000', red: '#ff0000', purple: '#800080', fuchsia: '#ff00ff', magenta: '#ff00ff',
  green: '#008000', lime: '#00ff00', olive: '#808000', yellow: '#ffff00',
  navy: '#000080', blue: '#0000ff', teal: '#008080', aqua: '#00ffff', cyan: '#00ffff',
  orange: '#ffa500', pink: '#ffc0cb', brown: '#a52a2a', gold: '#ffd700', indigo: '#4b0082',
  violet: '#ee82ee', coral: '#ff7f50', crimson: '#dc143c', tomato: '#ff6347', salmon: '#fa8072',
  khaki: '#f0e68c', turquoise: '#40e0d0', tan: '#d2b48c', beige: '#f5f5dc', ivory: '#fffff0',
  lavender: '#e6e6fa', plum: '#dda0dd', orchid: '#da70d6', skyblue: '#87ceeb', royalblue: '#4169e1',
  darkgray: '#a9a9a9', darkgrey: '#a9a9a9', lightgray: '#d3d3d3', lightgrey: '#d3d3d3',
  dimgray: '#696969', whitesmoke: '#f5f5f5', gainsboro: '#dcdcdc', slategray: '#708090',
  darkblue: '#00008b', darkgreen: '#006400', darkred: '#8b0000', lightblue: '#add8e6',
  lightgreen: '#90ee90', rebeccapurple: '#663399',
};

function hexToRgba(hex: string): RGBA | null {
  let h = hex;
  if (!/^[0-9a-f]+$/i.test(h)) return null;
  if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6 && h.length !== 8) return null;
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) : 1 };
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

function parseNum(tok: string, pctScale: number): number | null {
  const t = tok.trim();
  if (t.endsWith('%')) {
    const v = parseFloat(t);
    return isNaN(v) ? null : (v / 100) * pctScale;
  }
  const v = Number(t);
  return isNaN(v) ? null : v;
}

function parseAlpha(tok: string | undefined): number | null {
  if (tok === undefined) return 1;
  const v = parseNum(tok, 1);
  return v === null ? null : clamp01(v);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

/** OKLab → sRGB (0..1, clamped to gamut). */
function oklabToRgb(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const gamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  return lin.map((c) => clamp01(gamma(c))) as [number, number, number];
}

export function parseCssColor(s: string): RGBA | null {
  const str = s.trim().toLowerCase();
  if (!str || str === 'currentcolor') return null;
  if (str === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (str.startsWith('#')) return hexToRgba(str.slice(1));
  const m = str.match(/^(rgba?|hsla?)\(\s*(.+?)\s*\)$/);
  if (m) {
    const fn = m[1];
    const parts = m[2].split(/\s*[,/]\s*|\s+/).filter(Boolean);
    if (parts.length < 3 || parts.length > 4) return null;
    const alpha = parseAlpha(parts[3]);
    if (alpha === null) return null;
    if (fn.startsWith('rgb')) {
      const c = parts.slice(0, 3).map((p) => parseNum(p, 255));
      if (c.some((v) => v === null)) return null;
      const [r, g, b] = c.map((v) => clamp01((v as number) / 255));
      return { r, g, b, a: alpha };
    }
    const h = parseFloat(parts[0]);
    const sat = parseNum(parts[1], 1);
    const lig = parseNum(parts[2], 1);
    if (isNaN(h) || sat === null || lig === null) return null;
    const [r, g, b] = hslToRgb(h, clamp01(sat > 1 ? sat / 100 : sat), clamp01(lig > 1 ? lig / 100 : lig));
    return { r, g, b, a: alpha };
  }
  const ok = str.match(/^(oklch|oklab)\(\s*(.+?)\s*\)$/);
  if (ok) {
    const parts = ok[2].split(/\s*\/\s*|\s+/).filter(Boolean);
    if (parts.length < 3 || parts.length > 4) return null;
    const alpha = parseAlpha(parts[3]);
    // L is 0..1 or a percentage; chroma/a/b percentages are of 0.4.
    const num = (p: string, pctOf: number) => (p === 'none' ? 0 : p.endsWith('%') ? (parseFloat(p) / 100) * pctOf : parseFloat(p));
    const L = num(parts[0], 1);
    const x = num(parts[1], 0.4);
    const y = ok[1] === 'oklch' ? parseFloat(parts[2]) || 0 : num(parts[2], 0.4);
    if (alpha === null || [L, x, y].some((v) => Number.isNaN(v))) return null;
    const [A, B] = ok[1] === 'oklch' ? [x * Math.cos((y * Math.PI) / 180), x * Math.sin((y * Math.PI) / 180)] : [x, y];
    const [r, g, b] = oklabToRgb(L, A, B);
    return { r, g, b, a: alpha };
  }
  const named = NAMED[str];
  return named ? hexToRgba(named.slice(1)) : null;
}

const PALETTE: Record<string, string> = {
  slate: 'f8fafc f1f5f9 e2e8f0 cbd5e1 94a3b8 64748b 475569 334155 1e293b 0f172a 020617',
  gray: 'f9fafb f3f4f6 e5e7eb d1d5db 9ca3af 6b7280 4b5563 374151 1f2937 111827 030712',
  zinc: 'fafafa f4f4f5 e4e4e7 d4d4d8 a1a1aa 71717a 52525b 3f3f46 27272a 18181b 09090b',
  neutral: 'fafafa f5f5f5 e5e5e5 d4d4d4 a3a3a3 737373 525252 404040 262626 171717 0a0a0a',
  stone: 'fafaf9 f5f5f4 e7e5e4 d6d3d1 a8a29e 78716c 57534e 44403c 292524 1c1917 0c0a09',
  red: 'fef2f2 fee2e2 fecaca fca5a5 f87171 ef4444 dc2626 b91c1c 991b1b 7f1d1d 450a0a',
  orange: 'fff7ed ffedd5 fed7aa fdba74 fb923c f97316 ea580c c2410c 9a3412 7c2d12 431407',
  amber: 'fffbeb fef3c7 fde68a fcd34d fbbf24 f59e0b d97706 b45309 92400e 78350f 451a03',
  yellow: 'fefce8 fef9c3 fef08a fde047 facc15 eab308 ca8a04 a16207 854d0e 713f12 422006',
  lime: 'f7fee7 ecfccb d9f99d bef264 a3e635 84cc16 65a30d 4d7c0f 3f6212 365314 1a2e05',
  green: 'f0fdf4 dcfce7 bbf7d0 86efac 4ade80 22c55e 16a34a 15803d 166534 14532d 052e16',
  emerald: 'ecfdf5 d1fae5 a7f3d0 6ee7b7 34d399 10b981 059669 047857 065f46 064e3b 022c22',
  teal: 'f0fdfa ccfbf1 99f6e4 5eead4 2dd4bf 14b8a6 0d9488 0f766e 115e59 134e4a 042f2e',
  cyan: 'ecfeff cffafe a5f3fc 67e8f9 22d3ee 06b6d4 0891b2 0e7490 155e75 164e63 083344',
  sky: 'f0f9ff e0f2fe bae6fd 7dd3fc 38bdf8 0ea5e9 0284c7 0369a1 075985 0c4a6e 082f49',
  blue: 'eff6ff dbeafe bfdbfe 93c5fd 60a5fa 3b82f6 2563eb 1d4ed8 1e40af 1e3a8a 172554',
  indigo: 'eef2ff e0e7ff c7d2fe a5b4fc 818cf8 6366f1 4f46e5 4338ca 3730a3 312e81 1e1b4b',
  violet: 'f5f3ff ede9fe ddd6fe c4b5fd a78bfa 8b5cf6 7c3aed 6d28d9 5b21b6 4c1d95 2e1065',
  purple: 'faf5ff f3e8ff e9d5ff d8b4fe c084fc a855f7 9333ea 7e22ce 6b21a8 581c87 3b0764',
  fuchsia: 'fdf4ff fae8ff f5d0fe f0abfc e879f9 d946ef c026d3 a21caf 86198f 701a75 4a044e',
  pink: 'fdf2f8 fce7f3 fbcfe8 f9a8d4 f472b6 ec4899 db2777 be185d 9d174d 831843 500724',
  rose: 'fff1f2 ffe4e6 fecdd3 fda4af fb7185 f43f5e e11d48 be123c 9f1239 881337 4c0519',
};
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

export function tailwindColor(name: string): RGBA | null {
  const n = name.trim().toLowerCase();
  if (n === 'white') return { r: 1, g: 1, b: 1, a: 1 };
  if (n === 'black') return { r: 0, g: 0, b: 0, a: 1 };
  if (n === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const m = n.match(/^([a-z]+)-(\d+)$/);
  if (!m || !(m[1] in PALETTE)) return null;
  const i = SHADES.indexOf(Number(m[2]));
  if (i < 0) return null;
  return hexToRgba(PALETTE[m[1]].split(' ')[i]);
}

export function withAlpha(c: RGBA, a: number): RGBA {
  return { r: c.r, g: c.g, b: c.b, a: clamp01(a) };
}
