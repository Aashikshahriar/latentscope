import type {
  Dataset,
  DemoSpec,
  GaussianClustersSpec,
  MetadataColumn,
  Provenance,
  SwissRollSpec,
} from '@/types/dataset';
import { datasetChecksum } from '@/utils/checksum';
import { assetUrl } from '@/utils/misc';
import { parseNpy } from '../import/npy';
import { gaussianClusters, multimodal, swissRoll, type GeneratedData } from './generators';

export type DemoKey =
  | 'gaussian-clusters'
  | 'swiss-roll'
  | 'iris'
  | 'digits'
  | 'text-minilm'
  | 'text-bge'
  | 'multimodal-a'
  | 'multimodal-b';

export interface DemoInfo {
  key: DemoKey;
  title: string;
  summary: string;
  tags: string[];
  synthetic: boolean;
  /** Approximate size for display before loading. */
  size: string;
  defaultSpec: DemoSpec;
  /** Demos with the same pairing key share observation identifiers (representation comparison). */
  pairing?: 'text' | 'multimodal';
}

export const DEFAULT_GAUSSIAN: GaussianClustersSpec = {
  kind: 'gaussian-clusters',
  clusters: 6,
  dimensions: 20,
  pointsPerCluster: 150,
  separation: 12,
  noise: 1,
  seed: 7,
};

export const DEFAULT_SWISS_ROLL: SwissRollSpec = { kind: 'swiss-roll', points: 1500, noise: 0.4, seed: 3 };

export const DEMOS: DemoInfo[] = [
  {
    key: 'gaussian-clusters',
    title: 'Synthetic Gaussian clusters',
    summary:
      'Configurable isotropic clusters with unequal spreads — a controlled test of how projections treat cluster size and separation.',
    tags: ['synthetic', 'configurable'],
    synthetic: true,
    size: '900 × 20 (default)',
    defaultSpec: DEFAULT_GAUSSIAN,
  },
  {
    key: 'swiss-roll',
    title: 'Swiss roll manifold',
    summary: 'A 2-D sheet rolled up in 3-D. Linear PCA cannot unroll it; neighbourhood methods can.',
    tags: ['synthetic', 'manifold'],
    synthetic: true,
    size: '1 500 × 3 (default)',
    defaultSpec: DEFAULT_SWISS_ROLL,
  },
  {
    key: 'iris',
    title: 'Iris',
    summary: "Fisher's classic 150 flowers, four measurements, three species.",
    tags: ['real', 'classic'],
    synthetic: false,
    size: '150 × 4',
    defaultSpec: { kind: 'static', demo: 'iris' },
  },
  {
    key: 'digits',
    title: 'Handwritten digits',
    summary: '1 797 handwritten digits as 8×8 block-count images (UCI), with image previews.',
    tags: ['real', 'images'],
    synthetic: false,
    size: '1 797 × 64',
    defaultSpec: { kind: 'static', demo: 'digits' },
  },
  {
    key: 'text-minilm',
    title: 'Sentence embeddings · MiniLM',
    summary: '200 sentences on 8 topics embedded by the pretrained all-MiniLM-L6-v2 transformer (384-D).',
    tags: ['pretrained', 'text'],
    synthetic: false,
    size: '200 × 384',
    defaultSpec: { kind: 'static', demo: 'text-minilm' },
    pairing: 'text',
  },
  {
    key: 'text-bge',
    title: 'Sentence embeddings · BGE-small',
    summary:
      'The same 200 sentences embedded by bge-small-en-v1.5 — compare two models on identical observations.',
    tags: ['pretrained', 'text'],
    synthetic: false,
    size: '200 × 384',
    defaultSpec: { kind: 'static', demo: 'text-bge' },
    pairing: 'text',
  },
  {
    key: 'multimodal-a',
    title: 'Paired modalities · A (EEG-like)',
    summary:
      'SYNTHETIC. 480 simulated trials, 64 band-power features, sharing a latent state with modality B.',
    tags: ['synthetic', 'multimodal'],
    synthetic: true,
    size: '480 × 64',
    defaultSpec: { kind: 'multimodal', modality: 'a', seed: 11 },
    pairing: 'multimodal',
  },
  {
    key: 'multimodal-b',
    title: 'Paired modalities · B (fMRI-like)',
    summary: 'SYNTHETIC. The same 480 simulated trials observed through 120 smoothed regional responses.',
    tags: ['synthetic', 'multimodal'],
    synthetic: true,
    size: '480 × 120',
    defaultSpec: { kind: 'multimodal', modality: 'b', seed: 11 },
    pairing: 'multimodal',
  },
];

export function demoKeyForSpec(spec: DemoSpec): DemoKey {
  switch (spec.kind) {
    case 'gaussian-clusters':
      return 'gaussian-clusters';
    case 'swiss-roll':
      return 'swiss-roll';
    case 'multimodal':
      return spec.modality === 'a' ? 'multimodal-a' : 'multimodal-b';
    case 'static':
      return spec.demo;
  }
}

/** Deterministic dataset id for a demo specification, so experiments and links refer to it stably. */
export function demoDatasetId(spec: DemoSpec): string {
  switch (spec.kind) {
    case 'gaussian-clusters':
      return `demo:gaussian:k${spec.clusters}-d${spec.dimensions}-m${spec.pointsPerCluster}-sep${spec.separation}-noise${spec.noise}-seed${spec.seed}`;
    case 'swiss-roll':
      return `demo:swiss-roll:n${spec.points}-noise${spec.noise}-seed${spec.seed}`;
    case 'multimodal':
      return `demo:multimodal-${spec.modality}:seed${spec.seed}`;
    case 'static':
      return `demo:${spec.demo}`;
  }
}

export function validateGaussianSpec(spec: GaussianClustersSpec): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(spec.clusters) || spec.clusters < 1 || spec.clusters > 30)
    errors.push('Clusters must be between 1 and 30.');
  if (!Number.isInteger(spec.dimensions) || spec.dimensions < 2 || spec.dimensions > 512)
    errors.push('Dimensions must be between 2 and 512.');
  if (!Number.isInteger(spec.pointsPerCluster) || spec.pointsPerCluster < 2 || spec.pointsPerCluster > 5000) {
    errors.push('Points per cluster must be between 2 and 5 000.');
  }
  if (!(spec.separation >= 0)) errors.push('Separation must be non-negative.');
  if (!(spec.noise > 0)) errors.push('Noise must be positive.');
  if (!Number.isInteger(spec.seed)) errors.push('Seed must be an integer.');
  return errors;
}

const GENERATED_PROVENANCE = (description: string, preprocessing: string): Provenance => ({
  source: 'Generated in the browser by LatentScope from a seeded pseudo-random generator (Mulberry32).',
  license: 'Synthetic data — no restrictions (CC0-1.0).',
  featureDescription: description,
  preprocessing,
  synthetic: true,
});

async function fromGenerated(
  spec: DemoSpec,
  name: string,
  description: string,
  g: GeneratedData,
  provenance: Provenance,
): Promise<Dataset> {
  return {
    id: demoDatasetId(spec),
    name,
    description,
    source: { type: 'demo', spec },
    n: g.n,
    d: g.d,
    values: g.values,
    featureNames: g.featureNames,
    ids: g.ids,
    columns: g.columns as MetadataColumn[],
    checksum: await datasetChecksum(g.values, g.n, g.d, g.ids),
    provenance,
    createdAt: new Date().toISOString(),
    importNotes: [],
  };
}

interface StaticJson {
  name: string;
  n: number;
  d: number;
  featureNames: string[];
  ids: string[];
  values: number[];
  columns: MetadataColumn[];
  provenance: Provenance;
}

interface TextManifest {
  corpusLicense: string;
  rows: { id: string; topic: string; text: string }[];
  models: {
    key: string;
    source: string;
    license: string;
    pooling: string;
    n: number;
    d: number;
    transformersJs: string;
  }[];
}

async function fetchOk(path: string): Promise<Response> {
  const response = await fetch(assetUrl(path));
  if (!response.ok) throw new Error(`Could not load ${path} (HTTP ${response.status}).`);
  return response;
}

export async function loadDemo(spec: DemoSpec): Promise<Dataset> {
  switch (spec.kind) {
    case 'gaussian-clusters': {
      const errors = validateGaussianSpec(spec);
      if (errors.length > 0) throw new Error(errors.join(' '));
      return fromGenerated(
        spec,
        `Gaussian clusters (${spec.clusters} × ${spec.pointsPerCluster}, ${spec.dimensions}-D)`,
        DEMOS[0]!.summary,
        gaussianClusters(spec),
        GENERATED_PROVENANCE(
          `${spec.dimensions} real-valued coordinates. Centres ~ N(0, (s² / 2D)·I) with separation s = ${spec.separation}; points = centre + ${spec.noise} × spread × N(0, I), spread ∈ [0.6, 1.4] per cluster; seed ${spec.seed}.`,
          'None.',
        ),
      );
    }
    case 'swiss-roll':
      return fromGenerated(
        spec,
        `Swiss roll (${spec.points} points)`,
        DEMOS[1]!.summary,
        swissRoll(spec),
        GENERATED_PROVENANCE(
          `3-D coordinates (t cos t, h, t sin t) + ${spec.noise}·N(0, I) with t ~ U(1.5π, 4.5π), h ~ U(0, 21), as in scikit-learn's make_swiss_roll; seed ${spec.seed}.`,
          'None. "position_t" is the intrinsic coordinate along the roll.',
        ),
      );
    case 'multimodal': {
      const key = spec.modality === 'a' ? 'multimodal-a' : 'multimodal-b';
      const info = DEMOS.find((d) => d.key === key)!;
      return fromGenerated(
        spec,
        `${info.title} — synthetic`,
        info.summary,
        multimodal(spec),
        GENERATED_PROVENANCE(
          spec.modality === 'a'
            ? '64 simulated band-power features (16 channels × 4 bands): tanh(W_A z + b_A) + subject offset + Gaussian noise, from a 4-D latent state z per trial.'
            : '120 simulated regional responses: softplus(W_B z) + spatially smoothed Gaussian noise, from the same latent state z per trial.',
          'None. These are not recordings of any person; they illustrate representation comparison on paired data.',
        ),
      );
    }
    case 'static': {
      if (spec.demo === 'iris' || spec.demo === 'digits') {
        const json = (await (await fetchOk(`datasets/${spec.demo}.json`)).json()) as StaticJson;
        const values = Float32Array.from(json.values);
        return {
          id: demoDatasetId(spec),
          name: json.name,
          description: DEMOS.find((d) => d.key === spec.demo)!.summary,
          source: { type: 'demo', spec },
          n: json.n,
          d: json.d,
          values,
          featureNames: json.featureNames,
          ids: json.ids,
          columns: json.columns,
          checksum: await datasetChecksum(values, json.n, json.d, json.ids),
          provenance: json.provenance,
          createdAt: new Date().toISOString(),
          importNotes: [],
        };
      }
      const [manifest, npyBuffer] = await Promise.all([
        fetchOk('datasets/text-metadata.json').then((r) => r.json() as Promise<TextManifest>),
        fetchOk(`datasets/${spec.demo}.npy`).then((r) => r.arrayBuffer()),
      ]);
      const array = parseNpy(npyBuffer);
      if (array.data.kind !== 'numeric' || array.shape.length !== 2)
        throw new Error('Bundled embedding file is malformed.');
      const [n, d] = array.shape as [number, number];
      const model = manifest.models.find((m) => m.key === spec.demo)!;
      const values = Float32Array.from(array.data.values);
      const ids = manifest.rows.map((r) => r.id);
      const info = DEMOS.find((x) => x.key === spec.demo)!;
      return {
        id: demoDatasetId(spec),
        name: info.title,
        description: info.summary,
        source: { type: 'demo', spec },
        n,
        d,
        values,
        featureNames: Array.from({ length: d }, (_, t) => `dim_${t}`),
        ids,
        columns: [
          { name: 'topic', role: 'label', kind: 'categorical', values: manifest.rows.map((r) => r.topic) },
          { name: 'text', role: 'text', kind: 'text', values: manifest.rows.map((r) => r.text) },
          {
            name: 'source_model',
            role: 'source-model',
            kind: 'categorical',
            values: Array(n).fill(model.source),
          },
        ],
        checksum: await datasetChecksum(values, n, d, ids),
        provenance: {
          source: `Sentences written for LatentScope (${manifest.corpusLicense}); embedded with the pretrained model ${model.source} (${model.license}).`,
          license: `Text: ${manifest.corpusLicense}. Model weights: ${model.license}. Embeddings: CC0-1.0.`,
          featureDescription: `${d}-dimensional sentence embeddings (${model.pooling === 'mean' ? 'mean pooling over token embeddings' : 'CLS-token pooling'}), L2-normalised.`,
          preprocessing: `Computed offline with transformers.js ${model.transformersJs} (ONNX export, fp32) by scripts/build-text-embeddings.mjs.`,
          synthetic: false,
          notes:
            'Cosine distance (or L2-normalised Euclidean distance) is the natural metric for these vectors.',
        },
        createdAt: new Date().toISOString(),
        importNotes: [],
      };
    }
  }
}
