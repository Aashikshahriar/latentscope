import type { GaussianClustersSpec, MultimodalSpec, SwissRollSpec } from '@/types/dataset';
import { createGaussian, createRng } from '@/utils/rng';

export interface GeneratedData {
  values: Float32Array;
  n: number;
  d: number;
  featureNames: string[];
  ids: string[];
  columns: {
    name: string;
    role: 'label' | 'custom' | 'modality';
    kind: 'categorical' | 'numeric';
    values: (string | number)[];
  }[];
}

/**
 * Isotropic Gaussian clusters. Centres are drawn from N(0, (separation² / 2D)·I), so the expected
 * distance between two centres is `separation` (in units of the within-cluster standard
 * deviation when noise = 1). Each cluster's spread is `noise` × a factor in [0.6, 1.4] so that
 * densities differ, which illustrates how t-SNE and UMAP equalise apparent cluster sizes.
 */
export function gaussianClusters(spec: GaussianClustersSpec): GeneratedData {
  const { clusters: k, dimensions: d, pointsPerCluster: m, separation, noise, seed } = spec;
  const rng = createRng(seed);
  const gauss = createGaussian(rng);
  const centreScale = separation / Math.sqrt(2 * d);
  const centres = Array.from({ length: k }, () => Array.from({ length: d }, () => gauss() * centreScale));
  const spreads = Array.from({ length: k }, () => noise * (0.6 + 0.8 * rng()));
  const n = k * m;
  const values = new Float32Array(n * d);
  const ids: string[] = [];
  const labels: string[] = [];
  const radius: number[] = [];
  const width = String(n).length;
  for (let c = 0; c < k; c++) {
    for (let j = 0; j < m; j++) {
      const i = c * m + j;
      let r2 = 0;
      for (let t = 0; t < d; t++) {
        const offset = gauss() * spreads[c]!;
        r2 += offset * offset;
        values[i * d + t] = centres[c]![t]! + offset;
      }
      ids.push(`pt_${String(i + 1).padStart(width, '0')}`);
      labels.push(`cluster ${c + 1}`);
      radius.push(Math.sqrt(r2));
    }
  }
  return {
    values,
    n,
    d,
    featureNames: Array.from({ length: d }, (_, t) => `x${t + 1}`),
    ids,
    columns: [
      { name: 'cluster', role: 'label', kind: 'categorical', values: labels },
      { name: 'distance_to_centre', role: 'custom', kind: 'numeric', values: radius },
    ],
  };
}

/**
 * Swiss roll as in scikit-learn's `make_swiss_roll`: t = 1.5π(1 + 2u), height h = 21v,
 * (x, y, z) = (t cos t, h, t sin t) + noise·ε. `t` is the intrinsic coordinate along the roll.
 */
export function swissRoll(spec: SwissRollSpec): GeneratedData {
  const { points: n, noise, seed } = spec;
  const rng = createRng(seed);
  const gauss = createGaussian(rng);
  const values = new Float32Array(n * 3);
  const ts: number[] = [];
  const segments: string[] = [];
  const width = String(n).length;
  const tMin = 1.5 * Math.PI;
  const tMax = 4.5 * Math.PI;
  for (let i = 0; i < n; i++) {
    const t = 1.5 * Math.PI * (1 + 2 * rng());
    const h = 21 * rng();
    values[i * 3] = t * Math.cos(t) + noise * gauss();
    values[i * 3 + 1] = h + noise * gauss();
    values[i * 3 + 2] = t * Math.sin(t) + noise * gauss();
    ts.push(t);
    segments.push(`segment ${Math.min(5, 1 + Math.floor(((t - tMin) / (tMax - tMin)) * 5))}`);
  }
  return {
    values,
    n,
    d: 3,
    featureNames: ['x', 'y (height)', 'z'],
    ids: Array.from({ length: n }, (_, i) => `roll_${String(i + 1).padStart(width, '0')}`),
    columns: [
      { name: 'position_t', role: 'custom', kind: 'numeric', values: ts },
      { name: 'segment', role: 'label', kind: 'categorical', values: segments },
    ],
  };
}

export const MULTIMODAL_CONDITIONS = ['rest', 'visual', 'auditory', 'motor', 'memory', 'attention'] as const;
const TRIALS_PER_CONDITION = 80;
const SUBJECTS = 8;

/**
 * Synthetic paired "neural" recordings — clearly not real data. Each trial has a latent state
 * z ∈ ℝ⁴ drawn around its condition's centre. Two simulated modalities observe the same z:
 *  - A ("EEG-like", 64 band-power features): tanh(W_A z + b_A) plus a per-subject offset and noise;
 *  - B ("fMRI-like", 120 regional responses): softplus(W_B z) with spatially smoothed noise.
 * Because both views share the latent state but differ in non-linearity, noise and nuisance
 * structure (subject offsets only affect A), the pair is a controlled test bed for
 * representation-similarity measures. Trial identifiers are shared between the two matrices.
 */
export function multimodal(spec: MultimodalSpec): GeneratedData {
  const rng = createRng(spec.seed);
  const gauss = createGaussian(rng);
  const latentDim = 4;
  const conditions = MULTIMODAL_CONDITIONS.length;
  const centres = Array.from({ length: conditions }, () =>
    Array.from({ length: latentDim }, () => gauss() * 1.6),
  );
  const n = conditions * TRIALS_PER_CONDITION;
  const latent: number[][] = [];
  const conditionLabels: string[] = [];
  const subjects: string[] = [];
  for (let c = 0; c < conditions; c++) {
    for (let j = 0; j < TRIALS_PER_CONDITION; j++) {
      latent.push(centres[c]!.map((v) => v + 0.55 * gauss()));
      conditionLabels.push(MULTIMODAL_CONDITIONS[c]!);
      subjects.push(`S${String((j % SUBJECTS) + 1).padStart(2, '0')}`);
    }
  }
  // Mixing matrices and nuisance structure are drawn from the same stream for both modalities so
  // that A and B are generated consistently regardless of which one is requested.
  const da = 64;
  const db = 120;
  const wa = Array.from({ length: da }, () => Array.from({ length: latentDim }, () => gauss() * 0.7));
  const ba = Array.from({ length: da }, () => gauss() * 0.3);
  const subjectOffset = Array.from({ length: SUBJECTS }, () =>
    Array.from({ length: da }, () => gauss() * 0.35),
  );
  const wb = Array.from({ length: db }, () => Array.from({ length: latentDim }, () => gauss() * 0.8));
  const noiseA = Array.from({ length: n }, () => Array.from({ length: da }, () => gauss() * 0.25));
  const rawNoiseB = Array.from({ length: n }, () => Array.from({ length: db }, () => gauss() * 0.6));

  const d = spec.modality === 'a' ? da : db;
  const values = new Float32Array(n * d);
  for (let i = 0; i < n; i++) {
    const z = latent[i]!;
    if (spec.modality === 'a') {
      const subject = i % SUBJECTS;
      for (let t = 0; t < da; t++) {
        let s = ba[t]!;
        for (let l = 0; l < latentDim; l++) s += wa[t]![l]! * z[l]!;
        values[i * da + t] = Math.tanh(s) + subjectOffset[subject]![t]! + noiseA[i]![t]!;
      }
    } else {
      for (let t = 0; t < db; t++) {
        let s = 0;
        for (let l = 0; l < latentDim; l++) s += wb[t]![l]! * z[l]!;
        const softplus = Math.log1p(Math.exp(s));
        // Neighbouring "regions" share noise (a 5-tap moving average), mimicking spatial smoothness.
        let smooth = 0;
        let count = 0;
        for (let o = -2; o <= 2; o++) {
          const r = t + o;
          if (r >= 0 && r < db) {
            smooth += rawNoiseB[i]![r]!;
            count++;
          }
        }
        values[i * db + t] = softplus + smooth / count;
      }
    }
  }
  const width = String(n).length;
  return {
    values,
    n,
    d,
    featureNames:
      spec.modality === 'a'
        ? Array.from(
            { length: da },
            (_, t) => `ch${Math.floor(t / 4) + 1}_${['delta', 'theta', 'alpha', 'beta'][t % 4]}`,
          )
        : Array.from({ length: db }, (_, t) => `roi_${t + 1}`),
    ids: Array.from({ length: n }, (_, i) => `trial_${String(i + 1).padStart(width, '0')}`),
    columns: [
      { name: 'condition', role: 'label', kind: 'categorical', values: conditionLabels },
      { name: 'subject', role: 'custom', kind: 'categorical', values: subjects },
      {
        name: 'modality',
        role: 'modality',
        kind: 'categorical',
        values: Array(n).fill(spec.modality === 'a' ? 'EEG-like (synthetic)' : 'fMRI-like (synthetic)'),
      },
    ],
  };
}
