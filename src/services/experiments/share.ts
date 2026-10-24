import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import type { AlgorithmParams, OutputDims, PreprocessingConfig } from '@/types/algorithms';
import type { DemoSpec } from '@/types/dataset';
import { useViewStore, type VisualSettings } from '@/stores/viewStore';
import type { Dataset } from '@/types/dataset';
import type { Experiment } from '@/types/experiment';
import type { ColorBy } from '@/visualization/common/colorMapping';

/**
 * A shareable configuration. It never contains observation values: demonstration datasets are
 * referenced by their generator specification, uploaded datasets only by name and checksum.
 */
export interface ShareConfig {
  v: 1;
  dataset:
    | { kind: 'demo'; spec: DemoSpec }
    | { kind: 'checksum'; checksum: string; name: string; n: number; d: number };
  algorithm: AlgorithmParams['algorithm'];
  params: AlgorithmParams;
  preprocessing: PreprocessingConfig;
  dims: OutputDims;
  view?: { colorBy: ColorBy; visuals: Partial<VisualSettings> };
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function encodeShareConfig(config: ShareConfig): string {
  return toBase64Url(deflateSync(strToU8(JSON.stringify(config)), { level: 9 }));
}

export function decodeShareConfig(encoded: string): ShareConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(strFromU8(inflateSync(fromBase64Url(encoded))));
  } catch {
    throw new Error('The shared link is damaged or incomplete.');
  }
  const c = parsed as Partial<ShareConfig>;
  if (c?.v !== 1 || !c.dataset || !c.params || !c.preprocessing || (c.dims !== 2 && c.dims !== 3)) {
    throw new Error('The shared link does not contain a valid LatentScope configuration.');
  }
  if (c.params.algorithm !== c.algorithm) throw new Error('The shared configuration is inconsistent.');
  return c as ShareConfig;
}

export function shareUrl(config: ShareConfig): string {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}#/explore?cfg=${encodeShareConfig(config)}`;
}

/** Builds a share configuration from an experiment and the current view settings. */
export function buildShareConfig(dataset: Dataset, experiment: Experiment): ShareConfig {
  const view = useViewStore.getState();
  return {
    v: 1,
    dataset:
      dataset.source.type === 'demo'
        ? { kind: 'demo', spec: dataset.source.spec }
        : { kind: 'checksum', checksum: dataset.checksum, name: dataset.name, n: dataset.n, d: dataset.d },
    algorithm: experiment.algorithm,
    params: experiment.params,
    preprocessing: experiment.preprocessing,
    dims: experiment.outputDims,
    view: {
      colorBy: view.colorBy.type === 'clustering' ? { type: 'none' } : view.colorBy,
      visuals: {
        pointSize: view.visuals.pointSize,
        opacity: view.visuals.opacity,
        categoricalPalette: view.visuals.categoricalPalette,
        sequentialPalette: view.visuals.sequentialPalette,
      },
    },
  };
}
