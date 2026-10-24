import type { Experiment } from '@/types/experiment';
import { useDatasetStore } from '@/stores/datasetStore';
import { useExperimentStore } from '@/stores/experimentStore';
import { useViewStore } from '@/stores/viewStore';
import { log } from '@/stores/logStore';
import { datasetFromSession, SessionValidationError, type SessionFile } from '@/services/export/session';
import { APP_VERSION, createId } from '@/utils/misc';
import { demoSpecFromId } from './open';

/**
 * Restores an exported session: finds (or rebuilds) the exact dataset by checksum, recreates the
 * experiment with its stored coordinates, and reapplies the view, selection and camera.
 */
export async function restoreSession(session: SessionFile, fileName: string): Promise<Experiment> {
  const store = useDatasetStore.getState();
  let dataset = await store.findByChecksum(session.dataset.checksum);
  if (!dataset && session.dataset.source.type === 'demo') {
    const spec = demoSpecFromId(session.dataset.id) ?? session.dataset.source.spec;
    const regenerated = await store.loadDemo(spec, false);
    if (regenerated.checksum === session.dataset.checksum) dataset = regenerated;
  }
  if (!dataset && session.dataset.embedded) {
    dataset = await datasetFromSession(session, fileName);
    store.addDataset(dataset, false);
  }
  if (!dataset) {
    throw new SessionValidationError(
      `This session refers to “${session.dataset.name}” (${session.dataset.n} × ${session.dataset.d}, SHA-256 ${session.dataset.checksum.slice(0, 12)}…), which is not loaded. Import that file first, then load the session again.`,
    );
  }
  if (!store.datasets[dataset.id]) store.addDataset(dataset, false);
  const ex = session.experiment;
  const experiment: Experiment = {
    id: createId('exp'),
    name: `${ex.name} (restored)`,
    datasetId: dataset.id,
    datasetName: dataset.name,
    datasetChecksum: dataset.checksum,
    algorithm: ex.algorithm,
    implementation: ex.implementation,
    params: ex.params,
    preprocessing: ex.preprocessing,
    outputDims: ex.outputDims,
    rowIndices: ex.rowIndices ? Uint32Array.from(ex.rowIndices) : null,
    coords: Float32Array.from(ex.coordinates),
    diagnostics: ex.diagnostics,
    metrics: ex.metrics,
    runtimeMs: ex.runtimeMs,
    createdAt: ex.createdAt,
    appVersion: APP_VERSION,
    environment: ex.environment,
  };
  useExperimentStore.getState().add(experiment);
  useDatasetStore.getState().setActive(dataset.id);
  useExperimentStore.getState().setActive(experiment.id);
  const idToRow = new Map(dataset.ids.map((id, i) => [id, i]));
  const selection = session.view.selection.ids
    .map((id) => idToRow.get(id))
    .filter((r): r is number => r !== undefined);
  useViewStore.setState({
    visuals: { ...useViewStore.getState().visuals, ...session.view.visuals },
    colorBy: session.view.colorBy,
    hidden: session.view.hidden,
    selection,
    pendingCamera: session.view.camera,
  });
  log('success', `Restored session “${ex.name}” from ${fileName}.`);
  return experiment;
}
