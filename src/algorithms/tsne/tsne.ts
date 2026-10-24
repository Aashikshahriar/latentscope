import type { TsneDiagnostics, TsneParams } from '@/types/algorithms';
import { createGaussian, createRng } from '@/utils/rng';
import { exactKnn } from '../linalg/knn';
import { centerColumns } from '../linalg/matrix';
import { pcaCentered } from '../pca/pca';
import {
  jointProbabilitiesDense,
  jointProbabilitiesSparse,
  MACHINE_EPSILON,
  type SparseP,
} from './affinities';
import { SpaceTree } from './sptree';

export const TSNE_DEFAULTS: TsneParams = {
  algorithm: 'tsne',
  perplexity: 30,
  learningRate: null,
  iterations: 1000,
  earlyExaggeration: 12,
  earlyExaggerationIterations: 250,
  init: 'pca',
  method: 'auto',
  theta: 0.5,
  pcaDims: 50,
  seed: 42,
};

/** Datasets up to this size use exact gradients under method 'auto'. */
export const TSNE_EXACT_LIMIT = 1500;

const MIN_GAIN = 0.01;
const MIN_GRAD_NORM = 1e-7;

export interface TsneValidation {
  errors: string[];
  warnings: string[];
}

export function validateTsneParams(params: TsneParams, n: number): TsneValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (n < 3) errors.push('t-SNE needs at least 3 observations.');
  if (!(params.perplexity > 0)) errors.push('Perplexity must be positive.');
  else if (params.perplexity >= n) {
    errors.push(`Perplexity (${params.perplexity}) must be less than the number of observations (${n}).`);
  } else if (3 * params.perplexity > n - 1) {
    warnings.push(
      `Perplexity ${params.perplexity} is large relative to N = ${n}: each point's neighbourhood covers most of the dataset. Values between 5 and ${Math.max(5, Math.floor((n - 1) / 3))} are more typical.`,
    );
  }
  if (!Number.isInteger(params.iterations) || params.iterations < 250) {
    errors.push('Use at least 250 iterations (the early-exaggeration phase alone takes 250).');
  }
  if (params.learningRate !== null && !(params.learningRate > 0))
    errors.push('Learning rate must be positive.');
  if (!(params.earlyExaggeration >= 1)) errors.push('Early exaggeration must be at least 1.');
  if (params.earlyExaggerationIterations < 0 || params.earlyExaggerationIterations >= params.iterations) {
    errors.push('The early-exaggeration phase must be shorter than the total number of iterations.');
  }
  if (!(params.theta > 0 && params.theta <= 1)) errors.push('Barnes–Hut θ must be in (0, 1].');
  if (!Number.isInteger(params.seed)) errors.push('The random seed must be an integer.');
  if (params.method === 'exact' && n > 5000) {
    errors.push('Exact t-SNE is limited to 5 000 observations (O(N²) memory); use Barnes–Hut.');
  }
  return { errors, warnings };
}

export interface TsneProgress {
  iteration: number;
  total: number;
  kl: number | null;
  phase: 'exaggeration' | 'refinement';
}

/**
 * t-distributed Stochastic Neighbour Embedding (van der Maaten & Hinton, 2008), with the
 * Barnes–Hut approximation (van der Maaten, 2014) for larger datasets.
 *
 * Low-dimensional similarities use a Student-t kernel with one degree of freedom,
 *   q_ij = (1 + ‖y_i − y_j‖²)⁻¹ / Σ_{k≠l} (1 + ‖y_k − y_l‖²)⁻¹,
 * in both 2D and 3D. (scikit-learn uses max(dims − 1, 1) degrees of freedom, so its 3D output
 * differs by design.) The gradient of KL(P‖Q) is
 *   ∂C/∂y_i = 4 Σ_j (p_ij − q_ij)(y_i − y_j)(1 + ‖y_i − y_j‖²)⁻¹.
 *
 * Optimisation follows scikit-learn: gradient descent with momentum (0.5 during early
 * exaggeration, 0.8 afterwards), per-parameter adaptive gains (+0.2 / ×0.8, floor 0.01), and the
 * automatic learning rate max(N / α / 4, 50).
 *
 * The class is step-based so callers (a worker, a tutorial) control scheduling, previews and
 * cancellation.
 */
export class TSNE {
  readonly n: number;
  readonly dims: 2 | 3;
  readonly params: TsneParams;
  readonly method: 'exact' | 'barnes-hut';
  readonly learningRate: number;
  readonly totalIterations: number;
  readonly inputDims: number;
  readonly pcaPreReduced: boolean;

  /** Current embedding, N × dims row-major. */
  readonly y: Float64Array;
  private readonly update: Float64Array;
  private readonly gains: Float64Array;
  private readonly grad: Float64Array;
  private denseP: Float64Array | null = null;
  private denseNum: Float64Array | null = null;
  private sparseP: SparseP | null = null;
  private tree: SpaceTree | null = null;
  private stack = new Int32Array(1024);
  iteration = 0;
  lastKl: number | null = null;
  effectivePerplexity = 0;
  converged = false;
  readonly klHistory: { iteration: number; kl: number }[] = [];
  readonly warnings: string[] = [];

  constructor(
    data: Float64Array,
    n: number,
    d: number,
    dims: 2 | 3,
    params: TsneParams,
    onStage?: (stage: string, fraction: number | null) => void,
  ) {
    const validation = validateTsneParams(params, n);
    if (validation.errors.length > 0) throw new RangeError(validation.errors.join(' '));
    this.warnings.push(...validation.warnings);
    this.n = n;
    this.dims = dims;
    this.params = params;
    this.totalIterations = params.iterations;
    this.method = params.method === 'auto' ? (n <= TSNE_EXACT_LIMIT ? 'exact' : 'barnes-hut') : params.method;
    this.learningRate = params.learningRate ?? Math.max(n / params.earlyExaggeration / 4, 50);

    // Optional PCA pre-reduction (common practice for high-dimensional inputs).
    let x = data;
    let xd = d;
    this.pcaPreReduced = false;
    if (params.pcaDims > 0 && d > params.pcaDims && n > params.pcaDims) {
      onStage?.(`Reducing ${d} features to ${params.pcaDims} principal components`, null);
      const centred = Float64Array.from(data);
      centerColumns(centred, n, d);
      const res = pcaCentered(centred, n, d, {
        outputDims: params.pcaDims,
        maxComponents: params.pcaDims,
        seed: params.seed,
      });
      x = res.scores;
      xd = params.pcaDims;
      this.pcaPreReduced = true;
    }
    this.inputDims = xd;

    if (this.method === 'exact') {
      onStage?.('Computing pairwise affinities', 0);
      const { P, meanPerplexity } = jointProbabilitiesDense(x, n, xd, params.perplexity, (f) =>
        onStage?.('Computing pairwise affinities', f),
      );
      this.denseP = P;
      this.effectivePerplexity = meanPerplexity;
    } else {
      const k = Math.min(n - 1, Math.floor(3 * params.perplexity + 1));
      onStage?.(`Finding ${k} nearest neighbours`, 0);
      const knn = exactKnn(x, n, xd, k, {
        onProgress: (f) => onStage?.(`Finding ${k} nearest neighbours`, f),
      });
      onStage?.('Computing sparse affinities', null);
      const { P, meanPerplexity } = jointProbabilitiesSparse(
        knn.indices,
        knn.distances,
        n,
        k,
        params.perplexity,
      );
      this.sparseP = P;
      this.effectivePerplexity = meanPerplexity;
      this.tree = new SpaceTree(dims, n);
    }

    this.y = this.initialEmbedding(x, n, xd);
    this.update = new Float64Array(n * dims);
    this.gains = new Float64Array(n * dims).fill(1);
    this.grad = new Float64Array(n * dims);
  }

  private initialEmbedding(x: Float64Array, n: number, d: number): Float64Array {
    const dims = this.dims;
    const y = new Float64Array(n * dims);
    if (this.params.init === 'pca' && d >= dims) {
      const centred = Float64Array.from(x);
      centerColumns(centred, n, d);
      const { scores } = pcaCentered(centred, n, d, {
        outputDims: dims,
        maxComponents: dims,
        seed: this.params.seed,
      });
      // Scale so that the first coordinate has standard deviation 1e-4 (as scikit-learn does).
      let mean = 0;
      for (let i = 0; i < n; i++) mean += scores[i * dims]!;
      mean /= n;
      let variance = 0;
      for (let i = 0; i < n; i++) variance += (scores[i * dims]! - mean) ** 2;
      const sd = Math.sqrt(variance / n);
      if (sd > 0) {
        for (let t = 0; t < y.length; t++) y[t] = (scores[t]! / sd) * 1e-4;
        return y;
      }
      this.warnings.push('PCA initialisation was degenerate; fell back to random initialisation.');
    }
    const gauss = createGaussian(createRng(this.params.seed));
    for (let t = 0; t < y.length; t++) y[t] = 1e-4 * gauss();
    return y;
  }

  get done(): boolean {
    return this.iteration >= this.totalIterations || this.converged;
  }

  get phase(): 'exaggeration' | 'refinement' {
    return this.iteration < this.params.earlyExaggerationIterations ? 'exaggeration' : 'refinement';
  }

  /** Performs one gradient-descent iteration. Returns the KL divergence when `computeError`. */
  step(computeError = false): number | null {
    if (this.done) return this.lastKl;
    const exaggeration = this.phase === 'exaggeration' ? this.params.earlyExaggeration : 1;
    const momentum = this.phase === 'exaggeration' ? 0.5 : 0.8;
    const kl =
      this.method === 'exact'
        ? this.exactGradient(exaggeration, computeError)
        : this.barnesHutGradient(exaggeration, computeError);

    const { grad, update, gains, y } = this;
    let gradNormSq = 0;
    for (let t = 0; t < y.length; t++) {
      const g = grad[t]!;
      gradNormSq += g * g;
      // Gain grows while the gradient keeps pointing against the previous update (delta-bar-delta).
      const opposite = update[t]! * g < 0;
      let gain = opposite ? gains[t]! + 0.2 : gains[t]! * 0.8;
      if (gain < MIN_GAIN) gain = MIN_GAIN;
      gains[t] = gain;
      update[t] = momentum * update[t]! - this.learningRate * gain * g;
      y[t]! += update[t]!;
    }
    this.iteration++;
    if (kl !== null && exaggeration === 1) {
      this.lastKl = kl;
      this.klHistory.push({ iteration: this.iteration, kl });
    }
    if (this.phase === 'refinement' && Math.sqrt(gradNormSq) < MIN_GRAD_NORM) this.converged = true;
    return kl;
  }

  /** Exact gradient; returns KL(P‖Q) computed with the un-exaggerated P when requested. */
  private exactGradient(exaggeration: number, computeError: boolean): number | null {
    const { n, dims, y, grad } = this;
    const P = this.denseP!;
    const num = (this.denseNum ??= new Float64Array(n * n));
    let sumQ = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dsq = 0;
        for (let k = 0; k < dims; k++) {
          const diff = y[i * dims + k]! - y[j * dims + k]!;
          dsq += diff * diff;
        }
        const q = 1 / (1 + dsq);
        num[i * n + j] = q;
        num[j * n + i] = q;
        sumQ += 2 * q;
      }
    }
    grad.fill(0);
    let kl = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const qUnnorm = num[i * n + j]!;
        const q = Math.max(qUnnorm / sumQ, MACHINE_EPSILON);
        const p = P[i * n + j]!;
        const mult = (exaggeration * p - q) * qUnnorm;
        for (let k = 0; k < dims; k++)
          grad[i * dims + k]! += 4 * mult * (y[i * dims + k]! - y[j * dims + k]!);
        if (computeError) kl += p * Math.log(Math.max(p, MACHINE_EPSILON) / q);
      }
    }
    return computeError ? kl : null;
  }

  private barnesHutGradient(exaggeration: number, computeError: boolean): number | null {
    const { n, dims, y, grad } = this;
    const P = this.sparseP!;
    const tree = this.tree!;
    tree.build(y, n);
    const thetaSq = this.params.theta * this.params.theta;
    const negForce = new Float64Array(n * dims);
    const f = new Float64Array(dims);
    let sumQ = 0;
    for (let i = 0; i < n; i++) {
      sumQ += tree.computeNonEdgeForces(i, y, thetaSq, f, this.stack);
      for (let k = 0; k < dims; k++) negForce[i * dims + k] = f[k]!;
    }
    let kl = 0;
    for (let i = 0; i < n; i++) {
      const posF = [0, 0, 0];
      for (let p = P.rowPtr[i]!; p < P.rowPtr[i + 1]!; p++) {
        const j = P.colIdx[p]!;
        const pij = P.values[p]!;
        let dsq = 0;
        for (let k = 0; k < dims; k++) {
          const diff = y[i * dims + k]! - y[j * dims + k]!;
          dsq += diff * diff;
        }
        const qUnnorm = 1 / (1 + dsq);
        const mult = exaggeration * pij * qUnnorm;
        for (let k = 0; k < dims; k++) posF[k]! += mult * (y[i * dims + k]! - y[j * dims + k]!);
        if (computeError) {
          const q = Math.max(qUnnorm / sumQ, MACHINE_EPSILON);
          kl += pij * Math.log(Math.max(pij, MACHINE_EPSILON) / q);
        }
      }
      for (let k = 0; k < dims; k++) grad[i * dims + k] = 4 * (posF[k]! - negForce[i * dims + k]! / sumQ);
    }
    return computeError ? kl : null;
  }

  /** Dense joint probabilities P (exact method only), e.g. for the tutorial heatmap. */
  get joint(): Float64Array | null {
    return this.denseP;
  }

  diagnostics(): TsneDiagnostics {
    return {
      kind: 'tsne',
      method: this.method,
      klDivergence: this.lastKl ?? Number.NaN,
      klHistory: this.klHistory,
      learningRate: this.learningRate,
      effectivePerplexity: this.effectivePerplexity,
      inputDims: this.inputDims,
      pcaPreReduced: this.pcaPreReduced,
      warnings: [
        ...this.warnings,
        ...(this.converged ? [`Converged early at iteration ${this.iteration} (gradient norm < 1e-7).`] : []),
      ],
    };
  }
}

/**
 * Evaluates KL(P‖Q) and its gradient for a given embedding with dense P (exact t-SNE).
 * Exposed for scientific tests against scikit-learn's `_kl_divergence`.
 */
export function klDivergenceExact(P: Float64Array, y: Float64Array, n: number, dims: number) {
  const num = new Float64Array(n * n);
  let sumQ = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let dsq = 0;
      for (let k = 0; k < dims; k++) dsq += (y[i * dims + k]! - y[j * dims + k]!) ** 2;
      const q = 1 / (1 + dsq);
      num[i * n + j] = q;
      num[j * n + i] = q;
      sumQ += 2 * q;
    }
  }
  const grad = new Float64Array(n * dims);
  let kl = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const q = Math.max(num[i * n + j]! / sumQ, MACHINE_EPSILON);
      const p = P[i * n + j]!;
      kl += p * Math.log(Math.max(p, MACHINE_EPSILON) / q);
      const mult = (p - q) * num[i * n + j]!;
      for (let k = 0; k < dims; k++) grad[i * dims + k]! += 4 * mult * (y[i * dims + k]! - y[j * dims + k]!);
    }
  }
  return { kl, grad };
}
