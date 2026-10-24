export type CategoricalPaletteId = 'latentscope' | 'okabe-ito' | 'tol-bright' | 'tableau10';
export type SequentialPaletteId = 'viridis' | 'cividis' | 'plasma' | 'magma';

export interface CategoricalPalette {
  id: CategoricalPaletteId;
  name: string;
  colorblindSafe: boolean;
  colors: string[];
}

export const CATEGORICAL_PALETTES: CategoricalPalette[] = [
  {
    id: 'latentscope',
    name: 'LatentScope',
    colorblindSafe: false,
    colors: [
      '#7C8CFF',
      '#38D9C5',
      '#C084FC',
      '#F59E0B',
      '#F472B6',
      '#60A5FA',
      '#A3E635',
      '#FB7185',
      '#2DD4BF',
      '#FACC15',
      '#94A3B8',
      '#E879F9',
    ],
  },
  {
    // Okabe & Ito (2008), "Color Universal Design". Black is replaced by grey for dark backgrounds.
    id: 'okabe-ito',
    name: 'Okabe–Ito',
    colorblindSafe: true,
    colors: ['#E69F00', '#56B4E9', '#009E73', '#F0E442', '#0072B2', '#D55E00', '#CC79A7', '#BBBBBB'],
  },
  {
    // Paul Tol's "bright" qualitative scheme.
    id: 'tol-bright',
    name: 'Tol bright',
    colorblindSafe: true,
    colors: ['#4477AA', '#EE6677', '#228833', '#CCBB44', '#66CCEE', '#AA3377', '#BBBBBB'],
  },
  {
    id: 'tableau10',
    name: 'Tableau 10',
    colorblindSafe: false,
    colors: [
      '#4E79A7',
      '#F28E2B',
      '#E15759',
      '#76B7B2',
      '#59A14F',
      '#EDC948',
      '#B07AA1',
      '#FF9DA7',
      '#9C755F',
      '#BAB0AC',
    ],
  },
];

export const SEQUENTIAL_PALETTES: Record<SequentialPaletteId, { name: string; stops: string[] }> = {
  viridis: {
    name: 'Viridis',
    stops: [
      '#440154',
      '#482878',
      '#3E4A89',
      '#31688E',
      '#26828E',
      '#1F9E89',
      '#35B779',
      '#6DCD59',
      '#B4DE2C',
      '#FDE725',
    ],
  },
  cividis: {
    name: 'Cividis',
    stops: [
      '#00224E',
      '#123570',
      '#3B496C',
      '#575D6D',
      '#707173',
      '#8A8779',
      '#A59C74',
      '#C3B369',
      '#E1CC55',
      '#FEE838',
    ],
  },
  plasma: {
    name: 'Plasma',
    stops: [
      '#0D0887',
      '#46039F',
      '#7201A8',
      '#9C179E',
      '#BD3786',
      '#D8576B',
      '#ED7953',
      '#FB9F3A',
      '#FDCA26',
      '#F0F921',
    ],
  },
  magma: {
    name: 'Magma',
    stops: [
      '#000004',
      '#180F3D',
      '#440F76',
      '#721F81',
      '#9E2F7F',
      '#CD4071',
      '#F1605D',
      '#FD9668',
      '#FEC98D',
      '#FCFDBF',
    ],
  },
};

export type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  const v = parseInt(full, 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  const to = (x: number) =>
    Math.round(Math.min(1, Math.max(0, x)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

/** Colour for category `index`; beyond the palette, golden-angle hues keep colours distinct. */
export function categoricalColor(paletteId: CategoricalPaletteId, index: number): string {
  const palette = CATEGORICAL_PALETTES.find((p) => p.id === paletteId) ?? CATEGORICAL_PALETTES[0]!;
  if (index < palette.colors.length) return palette.colors[index]!;
  const hue = (index * 137.508) % 360;
  return rgbToHex(hslToRgb(hue, 0.65, 0.62));
}

export function paletteSize(paletteId: CategoricalPaletteId): number {
  return (CATEGORICAL_PALETTES.find((p) => p.id === paletteId) ?? CATEGORICAL_PALETTES[0]!).colors.length;
}

/** Linear interpolation through the palette stops; t is clamped to [0, 1]. */
export function sequentialColor(paletteId: SequentialPaletteId, t: number): Rgb {
  const stops = SEQUENTIAL_PALETTES[paletteId].stops;
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const a = hexToRgb(stops[i]!);
  const b = hexToRgb(stops[i + 1]!);
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export function sequentialGradientCss(paletteId: SequentialPaletteId): string {
  const stops = SEQUENTIAL_PALETTES[paletteId].stops;
  return `linear-gradient(90deg, ${stops.map((c, i) => `${c} ${(i / (stops.length - 1)) * 100}%`).join(', ')})`;
}

/** Marker shapes used for colour-independent category encoding. Index matches the shader. */
export const MARKER_SHAPES = ['circle', 'square', 'triangle', 'diamond', 'cross', 'ring'] as const;
export type MarkerShape = (typeof MARKER_SHAPES)[number];
