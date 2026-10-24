import type { Dataset } from '@/types/dataset';

/** Detects datasets whose features are pixels named pixel_<row>_<col> forming a square image. */
export function pixelGrid(dataset: Dataset): number | null {
  const side = Math.round(Math.sqrt(dataset.d));
  if (side * side !== dataset.d || side < 2) return null;
  return dataset.featureNames.every((f) => /^pixel_\d+_\d+$/.test(f)) ? side : null;
}
