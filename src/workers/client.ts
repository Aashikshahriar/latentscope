import type { ComputeRequest, JobProgress, ResultFor, WorkerMessage } from './protocol';

export class JobCancelledError extends Error {
  constructor() {
    super('The computation was cancelled.');
    this.name = 'JobCancelledError';
  }
}

export interface ComputeJob<R> {
  promise: Promise<R>;
  /** Terminates the worker immediately; the promise rejects with JobCancelledError. */
  cancel: () => void;
}

/**
 * Runs one computation in a dedicated module worker. Each job gets its own worker so that
 * cancellation can terminate a tight numerical loop instantly and release its memory.
 * The request's typed arrays are structured-cloned, so the caller keeps its copy.
 */
export function runComputeJob<R extends ComputeRequest>(
  request: R,
  onProgress?: (progress: JobProgress) => void,
): ComputeJob<ResultFor<R>> {
  const worker = new Worker(new URL('./compute.worker.ts', import.meta.url), {
    type: 'module',
    name: `latentscope-${request.kind}`,
  });
  let settled = false;
  let rejectFn: (reason: unknown) => void = () => {};
  const promise = new Promise<ResultFor<R>>((resolve, reject) => {
    rejectFn = reject;
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.type === 'progress') {
        onProgress?.(message.progress);
        return;
      }
      settled = true;
      worker.terminate();
      if (message.type === 'result') resolve(message.result as ResultFor<R>);
      else reject(new Error(message.message));
    };
    worker.onerror = (event) => {
      settled = true;
      worker.terminate();
      reject(new Error(event.message || 'The compute worker failed to start.'));
    };
  });
  worker.postMessage(request);
  return {
    promise,
    cancel: () => {
      if (settled) return;
      settled = true;
      worker.terminate();
      rejectFn(new JobCancelledError());
    },
  };
}
