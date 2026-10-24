import type { Dataset } from '@/types/dataset';
import type { ClusteringResult } from '@/types/experiment';
import {
  categoricalColor,
  hexToRgb,
  MARKER_SHAPES,
  sequentialColor,
  type CategoricalPaletteId,
  type SequentialPaletteId,
} from './palettes';

export type ColorBy =
  { type: 'none' } | { type: 'column'; name: string } | { type: 'clustering'; id: string };

export interface CategoryInfo {
  key: string;
  label: string;
  color: string;
  count: number;
  shape: number;
}

export interface ColorMapping {
  mode: 'uniform' | 'categorical' | 'numeric';
  title: string;
  /** Per-dataset-row RGB in [0, 1]. */
  colors: Float32Array;
  /** Per-dataset-row category index (−1 = missing / not applicable). */
  categoryIndex: Int32Array;
  categories: CategoryInfo[];
  numericRange: [number, number] | null;
  missingCount: number;
  warnings: string[];
}

export const MISSING_KEY = '__missing__';
const MISSING_COLOR = '#5B6475';
const UNIFORM_COLOR = '#7C8CFF';

/** Category order: natural numeric order when all keys are numbers, otherwise first appearance sorted alphabetically. */
function orderCategories(keys: string[]): string[] {
  const allNumeric = keys.every((k) => k !== '' && !Number.isNaN(Number(k)));
  return [...keys].sort((a, b) =>
    allNumeric ? Number(a) - Number(b) : a.localeCompare(b, undefined, { numeric: true }),
  );
}

export function computeColorMapping(
  dataset: Dataset,
  colorBy: ColorBy,
  clusterings: ClusteringResult[],
  categoricalPalette: CategoricalPaletteId,
  sequentialPalette: SequentialPaletteId,
): ColorMapping {
  const n = dataset.n;
  const colors = new Float32Array(n * 3);
  const categoryIndex = new Int32Array(n).fill(-1);
  const warnings: string[] = [];

  const uniform = (title: string): ColorMapping => {
    const [r, g, b] = hexToRgb(UNIFORM_COLOR);
    for (let i = 0; i < n; i++) colors.set([r, g, b], i * 3);
    return {
      mode: 'uniform',
      title,
      colors,
      categoryIndex,
      categories: [],
      numericRange: null,
      missingCount: 0,
      warnings,
    };
  };

  let raw: (string | number | null)[] | null = null;
  let kind: 'categorical' | 'numeric' = 'categorical';
  let title = '';
  if (colorBy.type === 'column') {
    const column = dataset.columns.find((c) => c.name === colorBy.name);
    if (!column) return uniform('Uniform');
    raw = column.values;
    kind = column.kind === 'numeric' ? 'numeric' : 'categorical';
    title = column.name;
  } else if (colorBy.type === 'clustering') {
    const clustering = clusterings.find((c) => c.id === colorBy.id);
    if (!clustering) return uniform('Uniform');
    // −1 is DBSCAN noise; −2 marks rows outside the clustered subsample.
    raw = Array.from(clustering.assignments, (a) =>
      a === -1 && clustering.method === 'dbscan' ? 'noise' : a < 0 ? null : `C${a + 1}`,
    );
    title = `${clustering.method} (${clustering.space})`;
  } else {
    return uniform('Uniform');
  }

  if (kind === 'numeric') {
    let min = Infinity;
    let max = -Infinity;
    let missing = 0;
    for (const v of raw) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        if (v < min) min = v;
        if (v > max) max = v;
      } else missing++;
    }
    if (!Number.isFinite(min)) return uniform(title);
    const span = max - min || 1;
    const missingRgb = hexToRgb(MISSING_COLOR);
    for (let i = 0; i < n; i++) {
      const v = raw[i];
      const rgb =
        typeof v === 'number' && Number.isFinite(v)
          ? sequentialColor(sequentialPalette, (v - min) / span)
          : missingRgb;
      colors.set(rgb, i * 3);
    }
    return {
      mode: 'numeric',
      title,
      colors,
      categoryIndex,
      categories: [],
      numericRange: [min, max],
      missingCount: missing,
      warnings,
    };
  }

  const counts = new Map<string, number>();
  for (const v of raw) {
    const key = v === null || v === '' ? MISSING_KEY : String(v);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const keys = orderCategories([...counts.keys()].filter((k) => k !== MISSING_KEY));
  if (keys.length > 60)
    warnings.push(
      `${keys.length} categories: colours repeat in hue and are hard to distinguish. Consider a numeric or coarser column.`,
    );
  const lookup = new Map<string, number>();
  const categories: CategoryInfo[] = keys.map((key, i) => {
    lookup.set(key, i);
    return {
      key,
      label: key,
      color: categoricalColor(categoricalPalette, i),
      count: counts.get(key)!,
      shape: i % MARKER_SHAPES.length,
    };
  });
  const missingCount = counts.get(MISSING_KEY) ?? 0;
  if (missingCount > 0) {
    lookup.set(MISSING_KEY, categories.length);
    categories.push({
      key: MISSING_KEY,
      label: 'missing',
      color: MISSING_COLOR,
      count: missingCount,
      shape: 0,
    });
  }
  const rgbs = categories.map((c) => hexToRgb(c.color));
  for (let i = 0; i < n; i++) {
    const v = raw[i];
    const key = v === null || v === '' ? MISSING_KEY : String(v);
    const idx = lookup.get(key)!;
    categoryIndex[i] = idx;
    colors.set(rgbs[idx]!, i * 3);
  }
  return {
    mode: 'categorical',
    title,
    colors,
    categoryIndex,
    categories,
    numericRange: null,
    missingCount,
    warnings,
  };
}

/** Default colour-by: a label column if present, else the first categorical column. */
export function defaultColorBy(dataset: Dataset): ColorBy {
  const label =
    dataset.columns.find((c) => c.role === 'label') ?? dataset.columns.find((c) => c.kind === 'categorical');
  return label ? { type: 'column', name: label.name } : { type: 'none' };
}

export function encodeColorBy(c: ColorBy): string {
  return c.type === 'none' ? 'none' : c.type === 'column' ? `col:${c.name}` : `cl:${c.id}`;
}

export function decodeColorBy(v: string): ColorBy {
  if (v.startsWith('col:')) return { type: 'column', name: v.slice(4) };
  if (v.startsWith('cl:')) return { type: 'clustering', id: v.slice(3) };
  return { type: 'none' };
}
