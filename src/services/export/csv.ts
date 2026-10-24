import type { Dataset } from '@/types/dataset';
import type { Experiment } from '@/types/experiment';

/** RFC 4180 field quoting. */
export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : value;
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export interface CoordinateExportOptions {
  /** Restrict to these dataset rows (e.g. the selection). */
  rows?: number[] | null;
  metadataColumns: string[];
  precision?: number;
}

/**
 * Projected coordinates as CSV: sample_id, component_1 … component_k, then the requested
 * metadata columns. Rows follow the projection order (dataset order, or the recorded subsample).
 */
export function coordinatesCsv(
  dataset: Dataset,
  experiment: Experiment,
  options: CoordinateExportOptions,
): string {
  const dims = experiment.outputDims;
  const columns = options.metadataColumns
    .map((name) => dataset.columns.find((c) => c.name === name))
    .filter((c) => c !== undefined);
  const header = [
    'sample_id',
    ...Array.from({ length: dims }, (_, i) => `component_${i + 1}`),
    ...columns.map((c) => c.name),
  ];
  const lines = [header.map(csvField).join(',')];
  const filter = options.rows ? new Set(options.rows) : null;
  const count = experiment.coords.length / dims;
  const precision = options.precision ?? 6;
  for (let r = 0; r < count; r++) {
    const row = experiment.rowIndices ? experiment.rowIndices[r]! : r;
    if (filter && !filter.has(row)) continue;
    const fields: (string | number | null)[] = [dataset.ids[row]!];
    for (let k = 0; k < dims; k++)
      fields.push(Number(experiment.coords[r * dims + k]!.toPrecision(precision)));
    for (const c of columns) fields.push(c.values[row] ?? null);
    lines.push(fields.map(csvField).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function coordinatesJson(
  dataset: Dataset,
  experiment: Experiment,
  options: CoordinateExportOptions,
  metadata: object,
): string {
  const dims = experiment.outputDims;
  const filter = options.rows ? new Set(options.rows) : null;
  const columns = options.metadataColumns
    .map((name) => dataset.columns.find((c) => c.name === name))
    .filter((c) => c !== undefined);
  const count = experiment.coords.length / dims;
  const observations: Record<string, unknown>[] = [];
  for (let r = 0; r < count; r++) {
    const row = experiment.rowIndices ? experiment.rowIndices[r]! : r;
    if (filter && !filter.has(row)) continue;
    const entry: Record<string, unknown> = {
      id: dataset.ids[row],
      coordinates: Array.from(experiment.coords.subarray(r * dims, (r + 1) * dims)),
    };
    for (const c of columns) entry[c.name] = c.values[row] ?? null;
    observations.push(entry);
  }
  return JSON.stringify({ metadata, observations }, null, 1);
}
