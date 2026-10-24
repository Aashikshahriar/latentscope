/// <reference lib="webworker" />
import { runClustering, runComparison, runMetrics, runProjection } from './handlers';
import type { ComputeRequest, ComputeResult, JobProgress, WorkerMessage } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;

function post(message: WorkerMessage, transfer: Transferable[] = []): void {
  scope.postMessage(message, transfer);
}

function progress(p: JobProgress): void {
  post({ type: 'progress', progress: p }, p.preview ? [p.preview.buffer] : []);
}

function transferablesOf(result: ComputeResult): Transferable[] {
  switch (result.kind) {
    case 'project':
      return [result.coords.buffer, ...(result.rowIndices ? [result.rowIndices.buffer] : [])];
    case 'cluster':
      return [result.assignments.buffer];
    default:
      return [];
  }
}

scope.onmessage = (event: MessageEvent<ComputeRequest>) => {
  const request = event.data;
  try {
    let result: ComputeResult;
    switch (request.kind) {
      case 'project':
        result = runProjection(request, progress);
        break;
      case 'metrics':
        result = runMetrics(request, progress);
        break;
      case 'cluster':
        result = runClustering(request, progress);
        break;
      case 'compare':
        result = runComparison(request, progress);
        break;
    }
    post({ type: 'result', result }, transferablesOf(result));
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
