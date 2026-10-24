import type { PreprocessingConfig, SubsampleConfig } from '@/types/algorithms';
import { createRng, sampleWithoutReplacement } from '@/utils/rng';
import { selectRows } from '../linalg/matrix';

export const DEFAULT_PREPROCESSING: PreprocessingConfig = {
  center: true,
  standardize: false,
  l2Normalize: false,
  subsample: null,
};

export interface PreprocessResult {
  data: Float64Array;
  n: number;
  d: number;
  /** Dataset row of each output row, or null when all rows are used in order. */
  rowIndices: Uint32Array | null;
  means: Float64Array | null;
  scales: Float64Array | null;
  constantFeatures: number;
  warnings: string[];
}

/** Deterministic subsample indices (sorted ascending, so dataset order is preserved). */
export function subsampleIndices(n: number, config: SubsampleConfig): Uint32Array | null {
  if (config.size >= n) return null;
  if (config.size < 2) throw new RangeError('A subsample needs at least 2 observations.');
  return sampleWithoutReplacement(n, config.size, createRng(config.seed));
}

/**
 * Applies the preprocessing pipeline in a fixed, documented order:
 *   1. subsample rows (seeded, recorded)
 *   2. L2-normalise each row (optional; zero rows are left at zero)
 *   3. centre each feature (optional)
 *   4. divide each feature by its sample standard deviation, ddof = 1 (optional)
 * Features with zero variance are left unscaled (they are already constant), and reported.
 */
export function preprocess(
  values: Float32Array | Float64Array,
  n: number,
  d: number,
  config: PreprocessingConfig,
  /** Explicit rows to use (e.g. those recorded in an experiment); overrides `config.subsample`. */
  explicitRows?: Uint32Array | null,
): PreprocessResult {
  const warnings: string[] = [];
  const rowIndices =
    explicitRows !== undefined
      ? explicitRows
      : config.subsample
        ? subsampleIndices(n, config.subsample)
        : null;
  const data = selectRows(values, d, rowIndices);
  const rows = rowIndices ? rowIndices.length : n;

  if (config.l2Normalize) {
    let zeroRows = 0;
    for (let i = 0; i < rows; i++) {
      const off = i * d;
      let s = 0;
      for (let k = 0; k < d; k++) s += data[off + k]! * data[off + k]!;
      if (s === 0) {
        zeroRows++;
        continue;
      }
      const inv = 1 / Math.sqrt(s);
      for (let k = 0; k < d; k++) data[off + k]! *= inv;
    }
    if (zeroRows > 0) warnings.push(`${zeroRows} observation(s) have zero norm and were not normalised.`);
  }

  let means: Float64Array | null = null;
  let scales: Float64Array | null = null;
  let constantFeatures = 0;

  if (config.center || config.standardize) {
    means = new Float64Array(d);
    for (let i = 0; i < rows; i++) {
      const off = i * d;
      for (let k = 0; k < d; k++) means[k]! += data[off + k]!;
    }
    for (let k = 0; k < d; k++) means[k]! /= rows;
  }

  if (config.standardize && means) {
    scales = new Float64Array(d);
    for (let i = 0; i < rows; i++) {
      const off = i * d;
      for (let k = 0; k < d; k++) {
        const diff = data[off + k]! - means[k]!;
        scales[k]! += diff * diff;
      }
    }
    for (let k = 0; k < d; k++) {
      const sd = rows > 1 ? Math.sqrt(scales[k]! / (rows - 1)) : 0;
      if (sd === 0 || !Number.isFinite(sd)) {
        constantFeatures++;
        scales[k] = 1;
      } else {
        scales[k] = sd;
      }
    }
    if (constantFeatures > 0) {
      warnings.push(`${constantFeatures} constant feature(s) have zero variance and were not rescaled.`);
    }
  }

  if (means) {
    const subtract = config.center || config.standardize;
    for (let i = 0; i < rows; i++) {
      const off = i * d;
      for (let k = 0; k < d; k++) {
        let v = data[off + k]!;
        if (subtract) v -= means[k]!;
        if (scales) v /= scales[k]!;
        data[off + k] = v;
      }
    }
  }

  return { data, n: rows, d, rowIndices, means, scales, constantFeatures, warnings };
}
