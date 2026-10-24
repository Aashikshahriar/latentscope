/** Row-major dense matrix stored in a typed array. */
export interface DenseMatrix<T extends Float32Array | Float64Array = Float64Array> {
  data: T;
  rows: number;
  cols: number;
}

export function toFloat64(values: Float32Array | Float64Array): Float64Array {
  return values instanceof Float64Array ? values : Float64Array.from(values);
}

/** Copies the selected rows (in the given order) into a new Float64Array. */
export function selectRows(
  values: Float32Array | Float64Array,
  cols: number,
  rows: ArrayLike<number> | null,
): Float64Array {
  if (rows === null) return Float64Array.from(values);
  const out = new Float64Array(rows.length * cols);
  for (let r = 0; r < rows.length; r++) {
    const src = rows[r]! * cols;
    out.set(values.subarray(src, src + cols), r * cols);
  }
  return out;
}

export function squaredEuclidean(
  a: ArrayLike<number>,
  aOffset: number,
  b: ArrayLike<number>,
  bOffset: number,
  d: number,
): number {
  let sum = 0;
  for (let k = 0; k < d; k++) {
    const diff = a[aOffset + k]! - b[bOffset + k]!;
    sum += diff * diff;
  }
  return sum;
}

/** Per-row Euclidean norms. */
export function rowNorms(data: Float64Array, n: number, d: number): Float64Array {
  const norms = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const off = i * d;
    for (let k = 0; k < d; k++) s += data[off + k]! * data[off + k]!;
    norms[i] = Math.sqrt(s);
  }
  return norms;
}

/** Column means. */
export function columnMeans(data: Float64Array, n: number, d: number): Float64Array {
  const mean = new Float64Array(d);
  for (let i = 0; i < n; i++) {
    const off = i * d;
    for (let k = 0; k < d; k++) mean[k]! += data[off + k]!;
  }
  for (let k = 0; k < d; k++) mean[k]! /= n;
  return mean;
}

/** Subtracts column means in place and returns the means. */
export function centerColumns(data: Float64Array, n: number, d: number): Float64Array {
  const mean = columnMeans(data, n, d);
  for (let i = 0; i < n; i++) {
    const off = i * d;
    for (let k = 0; k < d; k++) data[off + k]! -= mean[k]!;
  }
  return mean;
}

/** Pearson correlation of two equal-length samples. Returns NaN if either is constant. */
export function pearson(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i]!;
    mb += b[i]!;
  }
  ma /= n;
  mb /= n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i]! - ma;
    const db = b[i]! - mb;
    sab += da * db;
    saa += da * da;
    sbb += db * db;
  }
  if (saa === 0 || sbb === 0) return Number.NaN;
  return sab / Math.sqrt(saa * sbb);
}

/** Average ranks (1-based) with ties sharing the mean rank, as in scipy.stats.rankdata. */
export function averageRanks(values: ArrayLike<number>): Float64Array {
  const n = values.length;
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((x, y) => values[x]! - values[y]!);
  const ranks = new Float64Array(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && values[order[j + 1]!] === values[order[i]!]) j++;
    const rank = (i + j) / 2 + 1;
    for (let t = i; t <= j; t++) ranks[order[t]!] = rank;
    i = j + 1;
  }
  return ranks;
}

export function spearman(a: ArrayLike<number>, b: ArrayLike<number>): number {
  return pearson(averageRanks(a), averageRanks(b));
}
