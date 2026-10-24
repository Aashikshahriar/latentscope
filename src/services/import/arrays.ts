import type { ColumnKind, MetadataColumn } from '@/types/dataset';
import type { NpyArray } from './npy';
import type { ArrayMapping, ArrayPreview, CellIssue, ExtractedData } from './types';

const FLOAT32_MAX = 3.4028234663852886e38;

export function describeShape(shape: number[]): string {
  return shape.length === 0 ? 'scalar' : shape.join(' × ');
}

/** Whether an array can serve as the N × D embedding matrix. */
export function embeddingCandidate(
  array: NpyArray,
  flattenTrailing: boolean,
): { ok: boolean; reason?: string } {
  if (array.data.kind !== 'numeric') return { ok: false, reason: 'not numeric' };
  if (array.shape.length === 2) return { ok: true };
  if (array.shape.length > 2) {
    return flattenTrailing
      ? { ok: true }
      : { ok: false, reason: `${array.shape.length}-D; enable flattening to use as N × D` };
  }
  return { ok: false, reason: array.shape.length === 1 ? '1-D (usable as metadata)' : 'scalar' };
}

export function extractArrays(preview: ArrayPreview, mapping: ArrayMapping): ExtractedData {
  const entry = preview.arrays.find((a) => a.name === mapping.embedding);
  if (!entry?.array) throw new Error('Select the array that contains the embedding matrix.');
  const array = entry.array;
  const check = embeddingCandidate(array, mapping.flattenTrailing);
  if (!check.ok) throw new Error(`"${entry.name}" cannot be used as an embedding matrix: ${check.reason}.`);
  if (array.data.kind !== 'numeric') throw new Error('The embedding matrix must be numeric.');
  const n = array.shape[0]!;
  const d = array.shape.slice(1).reduce((a, b) => a * b, 1);
  if (n === 0 || d === 0)
    throw new Error(`The embedding matrix is empty (shape ${describeShape(array.shape)}).`);
  const values = array.data.values;
  const warnings: string[] = [];
  if (array.shape.length > 2)
    warnings.push(`Flattened ${describeShape(array.shape)} to ${n} × ${d} in C (row-major) order.`);
  const issues: ExtractedData['issues'] = {
    missing: 0,
    nonNumeric: 0,
    infinite: 0,
    outOfRange: 0,
    rowsAffected: 0,
    examples: [],
  };
  for (let i = 0; i < n; i++) {
    let affected = false;
    for (let t = 0; t < d; t++) {
      const v = values[i * d + t]!;
      let kind: CellIssue['kind'] | null = null;
      if (Number.isNaN(v)) {
        issues.missing++;
        kind = 'missing';
      } else if (!Number.isFinite(v)) {
        issues.infinite++;
        kind = 'infinite';
      } else if (Math.abs(v) > FLOAT32_MAX) {
        issues.outOfRange++;
        kind = 'out-of-range';
      }
      if (kind) {
        affected = true;
        if (issues.examples.length < 12)
          issues.examples.push({ row: i + 1, column: `feature_${t}`, value: String(v), kind });
      }
    }
    if (affected) issues.rowsAffected++;
  }

  let ids: string[] | null = null;
  const columns: MetadataColumn[] = [];
  for (const [name, role] of Object.entries(mapping.metadata)) {
    if (role === 'ignore') continue;
    const meta = preview.arrays.find((a) => a.name === name)?.array;
    if (!meta) continue;
    if (meta.shape.length !== 1 || meta.shape[0] !== n) {
      throw new Error(
        `Metadata array "${name}" has shape ${describeShape(meta.shape)}; expected a 1-D array of length ${n}.`,
      );
    }
    const raw: (string | number | null)[] =
      meta.data.kind === 'string'
        ? meta.data.values
        : Array.from(meta.data.values, (v) => (Number.isNaN(v) ? null : v));
    if (role === 'id') {
      ids = raw.map((v) => (v === null ? '' : String(v)));
      continue;
    }
    const numeric = meta.data.kind === 'numeric';
    const categoricalRoles = new Set(['label', 'cluster', 'source-model', 'modality']);
    const kind: ColumnKind = categoricalRoles.has(role)
      ? 'categorical'
      : role === 'text' || role === 'image-url'
        ? 'text'
        : numeric
          ? 'numeric'
          : 'categorical';
    columns.push({
      name,
      role,
      kind,
      values: kind === 'numeric' ? raw : raw.map((v) => (v === null ? null : String(v))),
    });
  }

  return {
    n,
    d,
    values,
    featureNames: Array.from({ length: d }, (_, t) => `feature_${t}`),
    ids,
    columns,
    issues,
    warnings,
  };
}
