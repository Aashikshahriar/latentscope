import type {
  AlgorithmParams,
  OutputDims,
  PreprocessingConfig,
  ProjectionDiagnostics,
} from '@/types/algorithms';
import type { Dataset, DatasetSource, MetadataColumn } from '@/types/dataset';
import type { Experiment } from '@/types/experiment';
import type { QualityMetrics } from '@/types/metrics';
import type { CameraState, VisualSettings } from '@/stores/viewStore';
import type { ColorBy } from '@/visualization/common/colorMapping';
import { APP_VERSION } from '@/utils/misc';
import { datasetChecksum } from '@/utils/checksum';

export const SESSION_SCHEMA = 'latentscope.session';
export const SESSION_SCHEMA_VERSION = 1;

export interface SessionFile {
  schema: typeof SESSION_SCHEMA;
  schemaVersion: number;
  appVersion: string;
  exportedAt: string;
  dataset: {
    id: string;
    name: string;
    checksum: string;
    n: number;
    d: number;
    source: DatasetSource;
    /** Present only when the user explicitly chose to embed raw values. */
    embedded?: {
      featureNames: string[];
      ids: string[];
      values: number[];
      columns: MetadataColumn[];
    };
  };
  experiment: {
    name: string;
    algorithm: Experiment['algorithm'];
    implementation: Experiment['implementation'];
    params: AlgorithmParams;
    preprocessing: PreprocessingConfig;
    outputDims: OutputDims;
    rowIndices: number[] | null;
    coordinates: number[];
    diagnostics: ProjectionDiagnostics;
    metrics: QualityMetrics | null;
    runtimeMs: number;
    createdAt: string;
    environment: string;
  };
  view: {
    visuals: VisualSettings;
    colorBy: ColorBy;
    hidden: string[];
    selection: { ids: string[] };
    camera: CameraState | null;
  };
}

export function buildSession(
  experiment: Experiment,
  dataset: Dataset,
  view: SessionFile['view'],
  embedData: boolean,
  selectedMetadata: string[],
): SessionFile {
  return {
    schema: SESSION_SCHEMA,
    schemaVersion: SESSION_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    dataset: {
      id: dataset.id,
      name: dataset.name,
      checksum: dataset.checksum,
      n: dataset.n,
      d: dataset.d,
      source: dataset.source,
      embedded: embedData
        ? {
            featureNames: dataset.featureNames,
            ids: dataset.ids,
            values: Array.from(dataset.values),
            columns: dataset.columns.filter((c) => selectedMetadata.includes(c.name)),
          }
        : undefined,
    },
    experiment: {
      name: experiment.name,
      algorithm: experiment.algorithm,
      implementation: experiment.implementation,
      params: experiment.params,
      preprocessing: experiment.preprocessing,
      outputDims: experiment.outputDims,
      rowIndices: experiment.rowIndices ? Array.from(experiment.rowIndices) : null,
      coordinates: Array.from(experiment.coords),
      diagnostics: experiment.diagnostics,
      metrics: experiment.metrics,
      runtimeMs: experiment.runtimeMs,
      createdAt: experiment.createdAt,
      environment: experiment.environment,
    },
    view,
  };
}

export class SessionValidationError extends Error {}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new SessionValidationError(message);
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isNumberArray = (v: unknown): v is number[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'number' && Number.isFinite(x));

/** Validates the structure and internal consistency of a parsed session file. */
export function validateSession(raw: unknown): SessionFile {
  assert(isObject(raw), 'The file is not a JSON object.');
  assert(raw.schema === SESSION_SCHEMA, 'This is not a LatentScope session file.');
  assert(
    typeof raw.schemaVersion === 'number' && raw.schemaVersion <= SESSION_SCHEMA_VERSION,
    `Unsupported session schema version ${String(raw.schemaVersion)}; update LatentScope.`,
  );
  const ds = raw.dataset;
  assert(isObject(ds), 'Missing "dataset" section.');
  assert(typeof ds.checksum === 'string' && /^[0-9a-f]{64}$/.test(ds.checksum), 'Invalid dataset checksum.');
  assert(
    typeof ds.n === 'number' && typeof ds.d === 'number' && ds.n > 1 && ds.d > 0,
    'Invalid dataset shape.',
  );
  const ex = raw.experiment;
  assert(isObject(ex), 'Missing "experiment" section.');
  assert(['pca', 'tsne', 'umap'].includes(ex.algorithm as string), 'Unknown algorithm.');
  assert(ex.outputDims === 2 || ex.outputDims === 3, 'Output dimensions must be 2 or 3.');
  assert(isNumberArray(ex.coordinates), 'Coordinates must be finite numbers.');
  const rows = ex.rowIndices === null ? ds.n : Array.isArray(ex.rowIndices) ? ex.rowIndices.length : -1;
  assert(rows > 0, 'Invalid row indices.');
  assert(
    (ex.coordinates as number[]).length === rows * (ex.outputDims as number),
    'The number of coordinates does not match the number of rows.',
  );
  if (Array.isArray(ex.rowIndices)) {
    assert(
      ex.rowIndices.every((r) => Number.isInteger(r) && r >= 0 && r < (ds.n as number)),
      'Row indices are out of range.',
    );
  }
  assert(
    isObject(ex.params) && ex.params.algorithm === ex.algorithm,
    'Parameters do not match the algorithm.',
  );
  assert(isObject(raw.view), 'Missing "view" section.');
  if (ds.embedded !== undefined) {
    const em = ds.embedded;
    assert(isObject(em), 'Invalid embedded data.');
    assert(
      isNumberArray(em.values) && em.values.length === (ds.n as number) * (ds.d as number),
      'Embedded values have the wrong length.',
    );
    assert(Array.isArray(em.ids) && em.ids.length === ds.n, 'Embedded identifiers have the wrong length.');
  }
  return raw as unknown as SessionFile;
}

/** Rebuilds a dataset from embedded session data and verifies it against the recorded checksum. */
export async function datasetFromSession(session: SessionFile, fileName: string): Promise<Dataset> {
  const em = session.dataset.embedded;
  if (!em) throw new SessionValidationError('This session does not contain the dataset values.');
  const values = Float32Array.from(em.values);
  const checksum = await datasetChecksum(values, session.dataset.n, session.dataset.d, em.ids);
  if (checksum !== session.dataset.checksum)
    throw new SessionValidationError(
      'The embedded data does not match the recorded checksum; the file may have been modified.',
    );
  return {
    id: session.dataset.id,
    name: session.dataset.name,
    source: { type: 'session', fileName },
    n: session.dataset.n,
    d: session.dataset.d,
    values,
    featureNames: em.featureNames,
    ids: em.ids,
    columns: em.columns,
    checksum,
    createdAt: new Date().toISOString(),
    importNotes: [`Restored from session file ${fileName}.`],
  };
}
