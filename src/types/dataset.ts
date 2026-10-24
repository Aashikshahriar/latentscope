/** Semantic role of a metadata column. Roles drive defaults (e.g. colour by label) but never
 * change the underlying values. */
export type ColumnRole =
  'label' | 'cluster' | 'sample-name' | 'source-model' | 'modality' | 'image-url' | 'text' | 'custom';

export type ColumnKind = 'categorical' | 'numeric' | 'text';

export interface MetadataColumn {
  name: string;
  role: ColumnRole;
  kind: ColumnKind;
  /** One entry per observation; `null` marks a missing value. */
  values: (string | number | null)[];
}

export interface Provenance {
  source: string;
  license: string;
  citation?: string;
  url?: string;
  featureDescription: string;
  preprocessing: string;
  synthetic: boolean;
  notes?: string;
}

export type DemoId =
  | 'gaussian-clusters'
  | 'swiss-roll'
  | 'iris'
  | 'digits'
  | 'text-minilm'
  | 'text-bge'
  | 'multimodal-a'
  | 'multimodal-b';

export interface GaussianClustersSpec {
  kind: 'gaussian-clusters';
  clusters: number;
  dimensions: number;
  pointsPerCluster: number;
  separation: number;
  noise: number;
  seed: number;
}

export interface SwissRollSpec {
  kind: 'swiss-roll';
  points: number;
  noise: number;
  seed: number;
}

export interface MultimodalSpec {
  kind: 'multimodal';
  modality: 'a' | 'b';
  seed: number;
}

export interface StaticDemoSpec {
  kind: 'static';
  demo: 'iris' | 'digits' | 'text-minilm' | 'text-bge';
}

export type DemoSpec = GaussianClustersSpec | SwissRollSpec | MultimodalSpec | StaticDemoSpec;

export type DatasetSource =
  | { type: 'demo'; spec: DemoSpec }
  | { type: 'upload'; fileName: string; format: ImportFormat }
  | { type: 'session'; fileName: string };

export type ImportFormat = 'csv' | 'tsv' | 'json' | 'npy' | 'npz';

export interface Dataset {
  id: string;
  name: string;
  description?: string;
  source: DatasetSource;
  n: number;
  d: number;
  /** Row-major N × D feature matrix. */
  values: Float32Array;
  featureNames: string[];
  /** Unique observation identifiers, one per row. */
  ids: string[];
  columns: MetadataColumn[];
  /** SHA-256 hex digest over shape, values and ids. */
  checksum: string;
  provenance?: Provenance;
  createdAt: string;
  /** Record of import-time transformations (e.g. dropped rows), shown to the user. */
  importNotes: string[];
}

export interface DatasetSummary {
  id: string;
  name: string;
  n: number;
  d: number;
  checksum: string;
  source: DatasetSource;
  createdAt: string;
  sizeBytes: number;
}
