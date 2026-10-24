import { useMemo } from 'react';
import type { OutputDims } from '@/types/algorithms';
import type { Dataset } from '@/types/dataset';
import type { Experiment } from '@/types/experiment';
import { useDatasetStore } from '@/stores/datasetStore';
import { useActiveExperiment, useExperimentStore } from '@/stores/experimentStore';
import { useViewStore } from '@/stores/viewStore';
import { computeColorMapping, MISSING_KEY, type ColorMapping } from '@/visualization/common/colorMapping';

export interface DisplayedProjection {
  coords: Float32Array;
  dims: OutputDims;
  rowIndices: Uint32Array | null;
  experiment: Experiment | null;
  preview: { iteration: number; total: number } | null;
}

/** The projection to draw: a live preview while computing, otherwise the active experiment. */
export function useDisplayedProjection(dataset: Dataset | null): DisplayedProjection | null {
  const experiment = useActiveExperiment();
  const preview = useExperimentStore((s) => s.preview);
  return useMemo(() => {
    if (!dataset) return null;
    if (preview && preview.datasetId === dataset.id) {
      return {
        coords: preview.coords,
        dims: preview.dims,
        rowIndices: preview.rowIndices,
        experiment: null,
        preview: { iteration: preview.iteration, total: preview.total },
      };
    }
    if (experiment && experiment.datasetId === dataset.id) {
      return {
        coords: experiment.coords,
        dims: experiment.outputDims,
        rowIndices: experiment.rowIndices,
        experiment,
        preview: null,
      };
    }
    return null;
  }, [dataset, experiment, preview]);
}

export function useColorMapping(dataset: Dataset | null): ColorMapping | null {
  const colorBy = useViewStore((s) => s.colorBy);
  const categorical = useViewStore((s) => s.visuals.categoricalPalette);
  const sequential = useViewStore((s) => s.visuals.sequentialPalette);
  const clusterings = useDatasetStore((s) => (dataset ? s.clusterings[dataset.id] : undefined));
  return useMemo(
    () =>
      dataset ? computeColorMapping(dataset, colorBy, clusterings ?? [], categorical, sequential) : null,
    [dataset, colorBy, clusterings, categorical, sequential],
  );
}

/** Per-row hidden mask from hidden categories and "isolate selection". Null when nothing is hidden. */
export function useHiddenMask(dataset: Dataset | null, mapping: ColorMapping | null): Uint8Array | null {
  const hidden = useViewStore((s) => s.hidden);
  const isolate = useViewStore((s) => s.isolateSelection);
  const selection = useViewStore((s) => s.selection);
  return useMemo(() => {
    if (!dataset || !mapping) return null;
    const hasHidden = hidden.length > 0 && mapping.mode === 'categorical';
    const doIsolate = isolate && selection.length > 0;
    if (!hasHidden && !doIsolate) return null;
    const mask = new Uint8Array(dataset.n);
    if (hasHidden) {
      const hiddenIdx = new Set(
        mapping.categories
          .map((c, i) =>
            hidden.includes(c.key) || (c.key === MISSING_KEY && hidden.includes(MISSING_KEY)) ? i : -1,
          )
          .filter((i) => i >= 0),
      );
      for (let i = 0; i < dataset.n; i++) if (hiddenIdx.has(mapping.categoryIndex[i]!)) mask[i] = 1;
    }
    if (doIsolate) {
      const keep = new Uint8Array(dataset.n);
      for (const r of selection) keep[r] = 1;
      for (let i = 0; i < dataset.n; i++) if (!keep[i]) mask[i] = 1;
    }
    return mask;
  }, [dataset, mapping, hidden, isolate, selection]);
}

export function useShapes(mapping: ColorMapping | null): Int32Array | null {
  const shapeEncoding = useViewStore((s) => s.visuals.shapeEncoding);
  return useMemo(() => {
    if (!mapping || !shapeEncoding || mapping.mode !== 'categorical') return null;
    return Int32Array.from(mapping.categoryIndex, (c) => (c < 0 ? 0 : mapping.categories[c]!.shape));
  }, [mapping, shapeEncoding]);
}

export function axisTitlesFor(
  experiment: Experiment | null,
  algorithmHint?: string,
): [string, string, string] {
  const algo = experiment?.algorithm ?? algorithmHint;
  if (algo === 'pca') return ['PC 1', 'PC 2', 'PC 3'];
  if (algo === 'tsne') return ['t-SNE 1', 't-SNE 2', 't-SNE 3'];
  if (algo === 'umap') return ['UMAP 1', 'UMAP 2', 'UMAP 3'];
  return ['Dim 1', 'Dim 2', 'Dim 3'];
}

/** Coordinates of a dataset row within a projection (null if the row is not in a subsample). */
export function coordsOfRow(
  projection: { coords: Float32Array; dims: number; rowIndices: Uint32Array | null },
  row: number,
): number[] | null {
  let r = row;
  if (projection.rowIndices) {
    // rowIndices are sorted ascending: binary search.
    let lo = 0;
    let hi = projection.rowIndices.length - 1;
    r = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const v = projection.rowIndices[mid]!;
      if (v === row) {
        r = mid;
        break;
      }
      if (v < row) lo = mid + 1;
      else hi = mid - 1;
    }
    if (r < 0) return null;
  }
  return Array.from(projection.coords.subarray(r * projection.dims, (r + 1) * projection.dims));
}
