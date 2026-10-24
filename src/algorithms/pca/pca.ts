import { EigenvalueDecomposition, Matrix, SingularValueDecomposition } from 'ml-matrix';
import type { PcaDiagnostics } from '@/types/algorithms';
import { createGaussian, createRng } from '@/utils/rng';

/**
 * Principal Component Analysis on an already-centred matrix X_c (N × D, row-major).
 *
 * With X_c = U Σ Vᵀ, the principal directions are the columns of V, the covariance is
 * C = X_cᵀ X_c / (N − 1) with eigenvalues λ_i = σ_i² / (N − 1), and the scores are
 * Z = X_c V_k = U_k Σ_k.
 *
 * Method selection ('auto'):
 *  - 'svd': thin SVD of X_c (ml-matrix, Golub–Kahan) when N·D ≤ 4·10⁶. Most stable.
 *  - 'covariance-eigendecomposition': symmetric eigendecomposition of the D × D covariance when
 *    D ≤ N. Squares the condition number, which only affects components with variance below
 *    ~1e-8 of the largest — far below anything visible in a projection.
 *  - 'gram-eigendecomposition': eigendecomposition of the N × N Gram matrix when N < D
 *    (wide data, e.g. 200 samples × 4 096 features), recovering V = X_cᵀ U Σ⁻¹.
 *  - 'randomized-svd' (opt-in or very large inputs): Halko–Martinsson–Tropp range finder with
 *    oversampling 10 and 4 power iterations. Flagged as approximate.
 *
 * Signs are made deterministic: in each component the loading with the largest magnitude is
 * positive (the convention scikit-learn ≥ 1.5 uses for its loadings).
 */
export interface PcaOptions {
  /** Number of components to return scores for (2 or 3, or more for analysis). */
  outputDims: number;
  /** Number of components whose variance / loadings are reported (scree plot). */
  maxComponents?: number;
  solver?: 'auto' | 'exact' | 'randomized';
  seed?: number;
  /** Forces a specific method (used by tests to exercise every path). */
  forceMethod?: PcaDiagnostics['method'];
  onStage?: (stage: string) => void;
}

export interface PcaResult {
  /** N × outputDims scores. */
  scores: Float64Array;
  diagnostics: PcaDiagnostics;
}

const SVD_ELEMENT_LIMIT = 4_000_000;
const EIGEN_DIMENSION_LIMIT = 2_000;

export function pcaCentered(xc: Float64Array, n: number, d: number, options: PcaOptions): PcaResult {
  if (n < 2) throw new RangeError('PCA needs at least two observations.');
  if (d < 1) throw new RangeError('PCA needs at least one feature.');
  const warnings: string[] = [];
  const maxRank = Math.min(n - 1, d);
  const requested = Math.max(options.outputDims, Math.min(options.maxComponents ?? 20, d));
  const kComputed = Math.min(requested, Math.min(n, d));

  let totalVariance = 0;
  for (let i = 0; i < xc.length; i++) totalVariance += xc[i]! * xc[i]!;
  totalVariance /= n - 1;

  const solver = options.solver ?? 'auto';
  let method: PcaDiagnostics['method'];
  if (options.forceMethod) method = options.forceMethod;
  else if (solver === 'randomized') method = 'randomized-svd';
  else if (n * d <= SVD_ELEMENT_LIMIT) method = 'svd';
  else if (d <= n && d <= EIGEN_DIMENSION_LIMIT) method = 'covariance-eigendecomposition';
  else if (n < d && n <= EIGEN_DIMENSION_LIMIT) method = 'gram-eigendecomposition';
  else if (solver === 'exact') {
    throw new RangeError(
      `Exact PCA of a ${n} × ${d} matrix exceeds the browser limits; choose the randomized solver or subsample.`,
    );
  } else method = 'randomized-svd';

  options.onStage?.(stageLabel(method));
  let eigenvalues: number[];
  let directions: number[][]; // k × D

  if (method === 'svd') {
    ({ eigenvalues, directions } = viaSvd(xc, n, d, kComputed));
  } else if (method === 'covariance-eigendecomposition') {
    ({ eigenvalues, directions } = viaCovariance(xc, n, d, kComputed));
  } else if (method === 'gram-eigendecomposition') {
    ({ eigenvalues, directions } = viaGram(xc, n, d, kComputed));
  } else {
    ({ eigenvalues, directions } = viaRandomized(
      xc,
      n,
      d,
      Math.min(kComputed, maxRank || 1),
      options.seed ?? 0,
    ));
  }

  // Numerical noise can produce tiny negative eigenvalues; variance cannot be negative.
  eigenvalues = eigenvalues.map((v) => (v > 0 ? v : 0));
  const tolerance = Math.max(...eigenvalues, 0) * Math.max(n, d) * Number.EPSILON * 16;
  const rank = eigenvalues.filter((v) => v > tolerance).length;

  for (const dir of directions) {
    let maxIdx = 0;
    for (let k = 1; k < d; k++) if (Math.abs(dir[k]!) > Math.abs(dir[maxIdx]!)) maxIdx = k;
    if (dir[maxIdx]! < 0) for (let k = 0; k < d; k++) dir[k] = -dir[k]!;
  }

  const out = options.outputDims;
  if (rank < out) {
    warnings.push(
      `The centred data has rank ${rank}, so only ${rank} component(s) carry variance; the remaining axes are constant.`,
    );
  }

  const scores = new Float64Array(n * out);
  for (let c = 0; c < out; c++) {
    const dir = directions[c];
    if (!dir || eigenvalues[c]! <= tolerance) continue; // leave zero-variance axes at 0
    for (let i = 0; i < n; i++) {
      let s = 0;
      const off = i * d;
      for (let k = 0; k < d; k++) s += xc[off + k]! * dir[k]!;
      scores[i * out + c] = s;
    }
  }

  const ratio = eigenvalues.map((v) => (totalVariance > 0 ? v / totalVariance : 0));
  if (totalVariance === 0)
    warnings.push('All observations are identical after preprocessing; variance is zero.');

  return {
    scores,
    diagnostics: {
      kind: 'pca',
      method,
      exact: method !== 'randomized-svd',
      explainedVariance: eigenvalues,
      explainedVarianceRatio: ratio,
      totalVariance,
      components: directions,
      componentCount: directions.length,
      rank,
      warnings,
    },
  };
}

function stageLabel(method: PcaDiagnostics['method']): string {
  switch (method) {
    case 'svd':
      return 'Computing singular value decomposition';
    case 'covariance-eigendecomposition':
      return 'Eigendecomposition of the covariance matrix';
    case 'gram-eigendecomposition':
      return 'Eigendecomposition of the Gram matrix';
    case 'randomized-svd':
      return 'Randomized SVD (approximate)';
  }
}

function toMatrix(x: Float64Array, n: number, d: number): Matrix {
  const m = new Matrix(n, d);
  for (let i = 0; i < n; i++) for (let k = 0; k < d; k++) m.set(i, k, x[i * d + k]!);
  return m;
}

function viaSvd(xc: Float64Array, n: number, d: number, k: number) {
  const svd = new SingularValueDecomposition(toMatrix(xc, n, d), {
    computeLeftSingularVectors: false,
    computeRightSingularVectors: true,
    autoTranspose: true,
  });
  const s = svd.diagonal;
  const v = svd.rightSingularVectors;
  const order = s.map((_, i) => i).sort((a, b) => s[b]! - s[a]!);
  const eigenvalues: number[] = [];
  const directions: number[][] = [];
  for (let c = 0; c < Math.min(k, order.length); c++) {
    const j = order[c]!;
    eigenvalues.push((s[j]! * s[j]!) / (n - 1));
    directions.push(v.getColumn(j));
  }
  return { eigenvalues, directions };
}

function symmetricTopEigen(m: Matrix, k: number) {
  const evd = new EigenvalueDecomposition(m, { assumeSymmetric: true });
  const values = evd.realEigenvalues;
  const vectors = evd.eigenvectorMatrix;
  const order = values.map((_, i) => i).sort((a, b) => values[b]! - values[a]!);
  const top = order.slice(0, k);
  return { values: top.map((j) => values[j]!), vectors: top.map((j) => vectors.getColumn(j)) };
}

function viaCovariance(xc: Float64Array, n: number, d: number, k: number) {
  const cov = new Float64Array(d * d);
  for (let i = 0; i < n; i++) {
    const off = i * d;
    for (let a = 0; a < d; a++) {
      const xa = xc[off + a]!;
      if (xa === 0) continue;
      const row = a * d;
      for (let b = a; b < d; b++) cov[row + b]! += xa * xc[off + b]!;
    }
  }
  const m = new Matrix(d, d);
  for (let a = 0; a < d; a++) {
    for (let b = a; b < d; b++) {
      const v = cov[a * d + b]! / (n - 1);
      m.set(a, b, v);
      m.set(b, a, v);
    }
  }
  const { values, vectors } = symmetricTopEigen(m, k);
  return { eigenvalues: values, directions: vectors };
}

function viaGram(xc: Float64Array, n: number, d: number, k: number) {
  const gram = new Matrix(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let s = 0;
      const oi = i * d;
      const oj = j * d;
      for (let t = 0; t < d; t++) s += xc[oi + t]! * xc[oj + t]!;
      gram.set(i, j, s);
      gram.set(j, i, s);
    }
  }
  const { values, vectors } = symmetricTopEigen(gram, k);
  const eigenvalues: number[] = [];
  const directions: number[][] = [];
  for (let c = 0; c < values.length; c++) {
    const sigma2 = Math.max(values[c]!, 0);
    eigenvalues.push(sigma2 / (n - 1));
    const dir = new Array<number>(d).fill(0);
    const sigma = Math.sqrt(sigma2);
    if (sigma > 0) {
      const u = vectors[c]!;
      for (let i = 0; i < n; i++) {
        const ui = u[i]! / sigma;
        if (ui === 0) continue;
        const off = i * d;
        for (let t = 0; t < d; t++) dir[t]! += xc[off + t]! * ui;
      }
    }
    directions.push(dir);
  }
  return { eigenvalues, directions };
}

/**
 * Orthonormalises the columns of an n × k row-major matrix with two passes of modified
 * Gram–Schmidt ("twice is enough"). Columns that are numerically dependent on earlier ones are
 * set to zero rather than normalised, since normalising rounding noise yields a vector that is
 * not orthogonal to the basis.
 */
function orthonormalizeColumns(q: Float64Array, n: number, k: number): void {
  for (let c = 0; c < k; c++) {
    let original = 0;
    for (let i = 0; i < n; i++) original += q[i * k + c]! * q[i * k + c]!;
    original = Math.sqrt(original);
    for (let pass = 0; pass < 2; pass++) {
      for (let p = 0; p < c; p++) {
        let dot = 0;
        for (let i = 0; i < n; i++) dot += q[i * k + c]! * q[i * k + p]!;
        for (let i = 0; i < n; i++) q[i * k + c]! -= dot * q[i * k + p]!;
      }
    }
    let norm = 0;
    for (let i = 0; i < n; i++) norm += q[i * k + c]! * q[i * k + c]!;
    norm = Math.sqrt(norm);
    const dependent = !(norm > 1e-10 * original);
    for (let i = 0; i < n; i++) q[i * k + c] = dependent ? 0 : q[i * k + c]! / norm;
  }
}

function viaRandomized(xc: Float64Array, n: number, d: number, k: number, seed: number) {
  const l = Math.min(k + 10, Math.min(n, d));
  const gauss = createGaussian(createRng(seed));
  const omega = new Float64Array(d * l);
  for (let i = 0; i < omega.length; i++) omega[i] = gauss();

  // Y = X Ω  (n × l)
  const mulX = (b: Float64Array): Float64Array => {
    const out = new Float64Array(n * l);
    for (let i = 0; i < n; i++) {
      const off = i * d;
      for (let t = 0; t < d; t++) {
        const x = xc[off + t]!;
        if (x === 0) continue;
        for (let c = 0; c < l; c++) out[i * l + c]! += x * b[t * l + c]!;
      }
    }
    return out;
  };
  // Xᵀ Q  (d × l)
  const mulXt = (q: Float64Array): Float64Array => {
    const out = new Float64Array(d * l);
    for (let i = 0; i < n; i++) {
      const off = i * d;
      for (let t = 0; t < d; t++) {
        const x = xc[off + t]!;
        if (x === 0) continue;
        for (let c = 0; c < l; c++) out[t * l + c]! += x * q[i * l + c]!;
      }
    }
    return out;
  };

  let q = mulX(omega);
  orthonormalizeColumns(q, n, l);
  for (let iter = 0; iter < 4; iter++) {
    const z = mulXt(q);
    orthonormalizeColumns(z, d, l);
    q = mulX(z);
    orthonormalizeColumns(q, n, l);
  }
  // B = Qᵀ X (l × d); SVD of the small matrix gives the right singular vectors.
  const bt = mulXt(q); // d × l = Bᵀ
  const b = new Matrix(l, d);
  for (let t = 0; t < d; t++) for (let c = 0; c < l; c++) b.set(c, t, bt[t * l + c]!);
  const svd = new SingularValueDecomposition(b, {
    computeLeftSingularVectors: false,
    computeRightSingularVectors: true,
    autoTranspose: true,
  });
  const s = svd.diagonal;
  const v = svd.rightSingularVectors;
  const order = s.map((_, i) => i).sort((a2, b2) => s[b2]! - s[a2]!);
  const eigenvalues: number[] = [];
  const directions: number[][] = [];
  for (let c = 0; c < Math.min(k, order.length); c++) {
    const j = order[c]!;
    eigenvalues.push((s[j]! * s[j]!) / (n - 1));
    directions.push(v.getColumn(j));
  }
  return { eigenvalues, directions };
}
